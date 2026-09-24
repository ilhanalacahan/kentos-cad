"""Independent reference values for core operations called by name
(CLAUDE.md §23.4, docs/adr/0008): exact rational arithmetic on the
arguments' decimal text (Python fractions) and 60-digit square roots,
never KentOS code. Native Rust, WASM and (while it exists) the TypeScript
reference must stay within each case's bound.

    python3 scripts/fixtures/geometry_call_reference.py

Writes fixtures/geometry/v1/reference-calls.json. Arguments are written as
JSON numbers from their decimal text, so a reader gets the nearest float64,
as it would from a file; expected values are decimal text.
"""
import json
from decimal import Decimal, getcontext
from fractions import Fraction as F

getcontext().prec = 60
PI = Decimal("3.141592653589793238462643383279502884197169399375105820974944")

def D(f):
    """A Fraction as decimal text."""
    return format(Decimal(f.numerator) / Decimal(f.denominator), "f")

def sqrt(f):
    return (Decimal(f.numerator) / Decimal(f.denominator)).sqrt()

def P(x, y):
    """A point given as decimal text: (JSON args, exact value)."""
    return {"x": float(x), "y": float(y)}, (F(Decimal(x)), F(Decimal(y)))

E, N = Decimal("486512.34"), Decimal("4420187.52")
def T(dx, dy):
    return P(format(E + Decimal(dx), "f"), format(N + Decimal(dy), "f"))

cases = []
def case(name, fn, args, expect, bound):
    cases.append({"name": name, "fn": fn, "args": args, "expect": expect, "bound": bound})

# lineLine: exact rational parameters and point (TM coordinates).
(a, A), (b, B), (c, C), (d, Dd) = T("0", "0"), T("40.117", "3.205"), T("12.5", "-20.25"), T("15.875", "30.03")
rx, ry = B[0] - A[0], B[1] - A[1]
sx, sy = Dd[0] - C[0], Dd[1] - C[1]
qx, qy = C[0] - A[0], C[1] - A[1]
den = rx * sy - ry * sx
t = (qx * sy - qy * sx) / den
u = (qx * ry - qy * rx) / den
case("TM doğruları kesişimi", "lineLine", [a, b, c, d],
     {"p": {"x": D(A[0] + t * rx), "y": D(A[1] + t * ry)}, "t": D(t), "u": D(u)},
     # A TM coordinate carries 0.5 ulp (4.7e-10 m) of input rounding.
     "1e-8")

# circleThrough: exact centre, radius from a 60-digit root.
(p1, Q1), (p2, Q2), (p3, Q3) = T("0", "0"), T("30.5", "4.25"), T("11.75", "27.125")
ax, ay = Q2[0] - Q1[0], Q2[1] - Q1[1]
bx, by = Q3[0] - Q1[0], Q3[1] - Q1[1]
dd = 2 * (ax * by - ay * bx)
a2, b2 = ax * ax + ay * ay, bx * bx + by * by
cx, cy = (by * a2 - ay * b2) / dd, (ax * b2 - bx * a2) / dd
case("TM üç noktadan çember", "circleThrough", [p1, p2, p3],
     {"c": {"x": D(Q1[0] + cx), "y": D(Q1[1] + cy)}, "r": format(sqrt(cx * cx + cy * cy), "f")}, "1e-8")

# bulgeArc: a half circle on a TM chord (centre on the chord, a0 = π, sweep = π).
(ha, HA), (hb, HB) = T("0", "0"), T("20", "0")
case("TM yarım daire yayı", "bulgeArc", [ha, hb, 1],
     {"c": {"x": D((HA[0] + HB[0]) / 2), "y": D((HA[1] + HB[1]) / 2)}, "r": "10", "a0": format(PI, "f"), "sweep": format(PI, "f")}, "1e-9")
# segmentMid of the same half circle: 10 m to the right of travel.
case("TM yarım daire ortası", "segmentMid", [ha, hb, 1],
     {"x": D((HA[0] + HB[0]) / 2), "y": D(HA[1] - 10)}, "1e-9")

# distToSegment: perpendicular distance, exact square then a 60-digit root.
(sp, SP), (sa, SA), (sb, SB) = T("7.25", "9.5"), T("0", "0"), T("25", "2.5")
dx, dy = SB[0] - SA[0], SB[1] - SA[1]
tt = ((SP[0] - SA[0]) * dx + (SP[1] - SA[1]) * dy) / (dx * dx + dy * dy)
fx, fy = SP[0] - (SA[0] + tt * dx), SP[1] - (SA[1] + tt * dy)
case("TM noktanın parçaya uzaklığı", "distToSegment", [sp, sa, sb], format(sqrt(fx * fx + fy * fy), "f"), "1e-8")

# pathLength: a TM traverse, each leg a 60-digit root.
legs = [T("0", "0"), T("12.345", "6.789"), T("30.1", "2.2"), T("41.004", "19.87")]
total = sum(sqrt((legs[i][1][0] - legs[i - 1][1][0]) ** 2 + (legs[i][1][1] - legs[i - 1][1][1]) ** 2) for i in range(1, len(legs)))
case("TM poligon güzergâhı uzunluğu", "pathLength", [[l[0] for l in legs], False], format(total, "f"), "1e-8")

# circleCircle: two TM circles, both crossings.
(k1, K1), (k2, K2) = T("0", "0"), T("12", "5")
r1, r2 = F(10), F(8)
ddx, ddy = K2[0] - K1[0], K2[1] - K1[1]
d2 = ddx * ddx + ddy * ddy  # 169: d = 13 exactly
d = F(13)
aa = (r1 * r1 - r2 * r2 + d2) / (2 * d)
h = sqrt(r1 * r1 - aa * aa)
mx, my = K1[0] + aa * ddx / d, K1[1] + aa * ddy / d
hx, hy = Decimal(ddy.numerator) / Decimal(ddy.denominator) / 13, Decimal(ddx.numerator) / Decimal(ddx.denominator) / 13
MX, MY = Decimal(mx.numerator) / Decimal(mx.denominator), Decimal(my.numerator) / Decimal(my.denominator)
case("TM iki çember kesişimi", "circleCircle", [k1, 10, k2, 8],
     [{"x": format(MX + h * hx, "f"), "y": format(MY - h * hy, "f")}, {"x": format(MX - h * hx, "f"), "y": format(MY + h * hy, "f")}], "1e-8")

# tangentPoints from an outside point: c + (r²/d²)v ± (r·√(d²−r²)/d²)·perp(v).
(tp, TP), (tc, TC) = T("25", "10"), T("0", "0")
rr = F(6)
vx, vy = TP[0] - TC[0], TP[1] - TC[1]
dd2 = vx * vx + vy * vy
k = rr * rr / dd2
s = Decimal(rr.numerator) * sqrt(dd2 - rr * rr) / (Decimal(dd2.numerator) / Decimal(dd2.denominator))
def dec(f):
    return Decimal(f.numerator) / Decimal(f.denominator)
bxp, byp = dec(TC[0] + k * vx), dec(TC[1] + k * vy)
# Math: base + half comes first (counter-clockwise of the centre→point direction).
case("TM noktadan teğet noktaları", "tangentPoints", [tp, tc, 6],
     [{"x": format(bxp - s * dec(vy), "f"), "y": format(byp + s * dec(vx), "f")},
      {"x": format(bxp + s * dec(vy), "f"), "y": format(byp - s * dec(vx), "f")}], "1e-8")

# Arc length of a quarter circle and a TM arc through three points (radius from a root).
case("çeyrek yay uzunluğu (5π)", "arcLength", [{"c": {"x": 0, "y": 0}, "r": 10, "a0": 0, "a1": float(PI / 2)}], format(5 * PI, "f"), "1e-12")

doc = {
    "format": "kentos.geometry-call-reference",
    "version": 1,
    "source": "python fractions + 60-digit roots and pi (independent of KentOS code)",
    "note": "Arguments are JSON numbers from decimal text (a reader gets the nearest float64); expected values are decimal text; |actual − expected| ≤ bound for every number.",
    "cases": cases,
}
with open("fixtures/geometry/v1/reference-calls.json", "w") as f:
    f.write(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
for c in cases:
    print(c["fn"], c["name"])
