"""Independent reference values for the numeric policy (CLAUDE.md §23).

Computed with Python's exact `decimal` and `fractions` modules, never with
KentOS code, so the Rust core (native and WASM) is checked against an
outside reference and not against itself. Run from the repository root:

    python3 scripts/fixtures/numeric_reference.py

Writes fixtures/numeric/v1/{rounding,shares,distribution}.json.
"""
import json
from decimal import (Decimal, Context, ROUND_HALF_EVEN, ROUND_HALF_UP, ROUND_HALF_DOWN,
                     ROUND_UP, ROUND_DOWN, ROUND_CEILING, ROUND_FLOOR, InvalidOperation)
from fractions import Fraction
import re

# Policy mode names (contract) → Python decimal constants. Python's HALF_UP
# rounds half away from zero and HALF_DOWN half toward zero; UP is away from
# zero, DOWN toward zero; CEILING/FLOOR toward ±∞.
MODES = {
    "half_even": ROUND_HALF_EVEN,
    "half_away_from_zero": ROUND_HALF_UP,
    "half_toward_zero": ROUND_HALF_DOWN,
    "away_from_zero": ROUND_UP,
    "toward_zero": ROUND_DOWN,
    "toward_positive": ROUND_CEILING,
    "toward_negative": ROUND_FLOOR,
}
PLAIN = re.compile(r"^-?(0|[1-9][0-9]*)(\.[0-9]+)?$")
MAX_DIGITS = 28  # rust_decimal's significant digits: larger inputs must be refused, not rounded silently

def rounded(text, scale, mode):
    if not PLAIN.match(text):
        return {"error": "invalid_decimal"}
    d = Decimal(text)
    if len(d.as_tuple().digits) > MAX_DIGITS:
        return {"error": "too_many_digits"}
    q = d.quantize(Decimal(1).scaleb(-scale), rounding=MODES[mode], context=Context(prec=100))
    s = format(q, "f")
    if s.startswith("-") and Decimal(s) == 0:
        s = s[1:]  # no negative zero in results
    return {"value": s}

VALUES = [
    "2.5", "3.5", "-2.5", "-3.5", "0.5", "-0.5",              # exact halves at scale 0
    "2.45", "2.55", "-2.45", "2.4499999999999999", "2.4500000000000001",  # halves and both sides at scale 1
    "1234567.8950", "1234567.8949999", "-1234567.8950",       # areas at scale 3/2
    "0.005", "-0.005", "0.0049999", "0.0050001",              # small, at scale 2
    "999999999.9995", "4420187.52", "486512.3450",            # large coordinates
    "0", "-0", "7", "-0.0001",
]
ERRORS = ["NaN", "Infinity", "", "1e5", "1.2.3", "+1", "0x10", "12345678901234567890123456789.5"]
SCALES = [0, 1, 2, 3, 4]

rounding_cases = []
for v in VALUES:
    for scale in SCALES:
        for mode in MODES:
            rounding_cases.append({"input": v, "scale": scale, "mode": mode, "expected": rounded(v, scale, mode)})
for v in ERRORS:
    rounding_cases.append({"input": v, "scale": 2, "mode": "half_even", "expected": rounded(v, 2, "half_even")})

def frac(s):
    n, d = s.split("/")
    return Fraction(int(n), int(d))

SHARE_SETS = [
    ["1/3", "1/3", "1/3"],
    ["1/2", "1/3", "1/6"],
    ["2/5", "2/5", "1/6"],
    ["7918/7919", "1/7919"],
    ["2/4", "3/6"],
    ["1/1"],
    ["0/1", "1/1"],
]
share_cases = []
for parts in SHARE_SETS:
    fs = [frac(p) for p in parts]
    total = sum(fs, Fraction(0))
    share_cases.append({
        "input": parts,
        "expected": {
            "reduced": [f"{f.numerator}/{f.denominator}" for f in fs],
            "sum": f"{total.numerator}/{total.denominator}",
            "whole": total == 1,
        },
    })

def distribute(total, weights, scale, mode, remainder):
    """Exact shares of `total` by weight, rounded; the rounding remainder is
    given one unit at a time to the largest fractional parts (ties: input
    order) when the rule allows it, and refused otherwise."""
    t = Fraction(Decimal(total))
    ws = [Fraction(Decimal(w)) for w in weights]
    wsum = sum(ws, Fraction(0))
    if wsum <= 0:
        return {"error": "invalid_weights"}
    exact = [t * w / wsum for w in ws]
    unit = Fraction(1, 10 ** scale)
    q = Decimal(1).scaleb(-scale)
    ctx = Context(prec=100)
    parts = [(Decimal(e.numerator, context=ctx) / Decimal(e.denominator)).quantize(q, rounding=MODES[mode], context=ctx) for e in exact]
    diff = t - sum((Fraction(p) for p in parts), Fraction(0))
    steps = diff / unit
    if steps != int(steps):
        return {"error": "scale_too_fine_for_total"}
    steps = int(steps)
    if steps == 0:
        return {"parts": [format(p, "f") for p in parts], "remainder": "0"}
    if remainder == "reject":
        return {"error": "needs_rule", "remainder": format(Decimal(diff.numerator) / Decimal(diff.denominator), "f")}
    # largest_remainder: order by how far each part fell short (or overshot), ties by input order.
    sign = 1 if steps > 0 else -1
    shortfall = [(sign * (e - Fraction(p)), i) for i, (e, p) in enumerate(zip(exact, parts))]
    order = sorted(shortfall, key=lambda x: (-x[0], x[1]))
    out = list(parts)
    for k in range(abs(steps)):
        i = order[k % len(order)][1]
        out[i] = out[i] + sign * q
    return {"parts": [format(p, "f") for p in out], "remainder": format(Decimal(diff.numerator) / Decimal(diff.denominator), "f")}

DIST = [
    ("100.00", ["1", "1", "1"], 2, "half_even", "largest_remainder"),
    ("100.00", ["1", "1", "1"], 2, "half_even", "reject"),
    ("1000.0", ["3", "7"], 1, "half_even", "reject"),
    ("748.5151", ["0.3", "0.3", "0.4"], 4, "half_away_from_zero", "largest_remainder"),
    ("10", ["1", "1", "1", "1", "1", "1"], 0, "toward_zero", "largest_remainder"),
    ("-5.00", ["1", "2"], 2, "half_even", "largest_remainder"),
    ("1.00", ["0", "0"], 2, "half_even", "largest_remainder"),
]
dist_cases = [
    {"input": {"total": t, "weights": w, "scale": s, "mode": m, "remainder": r}, "expected": distribute(t, w, s, m, r)}
    for (t, w, s, m, r) in DIST
]

def write(name, cases):
    doc = {"format": "kentos.numeric-fixtures", "version": 1, "source": "python decimal/fractions (independent of KentOS code)", "cases": cases}
    with open(f"fixtures/numeric/v1/{name}.json", "w") as f:
        f.write(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")

write("rounding", rounding_cases)
write("shares", share_cases)
write("distribution", dist_cases)
print(len(rounding_cases), "rounding,", len(share_cases), "shares,", len(dist_cases), "distribution")
