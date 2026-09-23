"""Independent reference values for geometry (CLAUDE.md §23.4).

Areas are computed exactly from the coordinates' decimal text with Python
`fractions` (shoelace on rationals) and with closed formulas for arcs using
a 60-digit π, never with KentOS code. The TypeScript, native Rust and WASM
results must stay within each case's documented error bound of these values:
equality with the old TypeScript result is not accuracy (§19 Faz A).

    python3 scripts/fixtures/geometry_reference.py

Writes fixtures/geometry/v1/reference.json.
"""
import json
from decimal import Decimal, getcontext
from fractions import Fraction

getcontext().prec = 60
PI = Decimal("3.141592653589793238462643383279502884197169399375105820974944")

def shoelace(pts):
    a = Fraction(0)
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i - 1]
        x1, y1 = pts[i]
        a += Fraction(Decimal(x0)) * Fraction(Decimal(y1)) - Fraction(Decimal(x1)) * Fraction(Decimal(y0))
    return a / 2

def dec(f):
    return format(Decimal(f.numerator) / Decimal(f.denominator), "f")

# TM36 sample parcel (the same coordinates as the golden cases), as decimal text.
E, N = Decimal("486512.34"), Decimal("4420187.52")
def at(dx, dy):
    return [format(E + Decimal(dx), "f"), format(N + Decimal(dy), "f")]
parcel = [at("0", "0"), at("23.417", "1.203"), at("25.881", "31.466"), at("2.004", "33.012")]
hole = [at("5", "5"), at("5", "10"), at("10", "10"), at("10", "5")]
square = [["0", "0"], ["10", "0"], ["10", "10"], ["0", "10"]]

cases = []
a_parcel = shoelace(parcel)
cases.append({
    "name": "TM parsel alanı (ondalık metinden kesin)",
    "op": "polygonArea",
    "input": {"outer": {"pts": parcel}, "holes": []},
    "expected": dec(abs(a_parcel)),
    # Error of f64 inputs (≤ 0.5 ulp of 4.4e6 ≈ 4.7e-10 m per coordinate) through the
    # shoelace around the first vertex: far below a square millimetre.
    "bound": "1e-6",
})
a_hole = shoelace(hole)
cases.append({
    "name": "TM adalı alan (ondalık metinden kesin)",
    "op": "polygonArea",
    "input": {"outer": {"pts": parcel}, "holes": [{"pts": hole}]},
    "expected": dec(abs(a_parcel) - abs(a_hole)),
    "bound": "1e-6",
})
cases.append({
    "name": "tam daire, iki yarım yay (25π)",
    "op": "polygonArea",
    "input": {"outer": {"pts": [["-5", "0"], ["5", "0"]], "bulges": ["1", "1"]}, "holes": []},
    "expected": format(25 * PI, "f"),
    "bound": "1e-12",
})
cases.append({
    "name": "kare + yarım daire çıkıntı (100 + 12,5π)",
    "op": "polygonArea",
    "input": {"outer": {"pts": square, "bulges": ["1", "0", "0", "0"]}, "holes": []},
    "expected": format(100 + Decimal("12.5") * PI, "f"),
    "bound": "1e-12",
})
cases.append({
    "name": "kare − yarım daire girinti (100 − 12,5π)",
    "op": "polygonArea",
    "input": {"outer": {"pts": square, "bulges": ["-1", "0", "0", "0"]}, "holes": []},
    "expected": format(100 - Decimal("12.5") * PI, "f"),
    "bound": "1e-12",
})
cases.append({
    "name": "yarım daire çevresi (10 + 5π)",
    "op": "polygonPerimeter",
    "input": {"outer": {"pts": [["0", "0"], ["10", "0"]], "bulges": ["1", "0"]}, "holes": []},
    "expected": format(10 + 5 * PI, "f"),
    "bound": "1e-12",
})

doc = {
    "format": "kentos.geometry-reference",
    "version": 1,
    "source": "python fractions + 60-digit pi (independent of KentOS code)",
    "note": "Coordinates and bulges are decimal text; implementations parse them to f64 as a file reader would.",
    "cases": cases,
}
with open("fixtures/geometry/v1/reference.json", "w") as f:
    f.write(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
for c in cases:
    print(c["name"], c["expected"][:24])
