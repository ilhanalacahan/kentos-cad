//! The values of an SVG file as the importer reads them
//! (`apps/web/src/style/svg/svgValues.ts`): colours (every CSS syntax and
//! keyword, with alpha), paints (the symbol's colours, references),
//! transforms, lengths with units, viewBox mapping with
//! preserveAspectRatio, and `<style>` sheets with the selectors icon files
//! use (class, id, tag, attribute, descendant and child). Text rules are
//! JavaScript's (`\s`, `trim`, `Number`, `parseFloat`), as the TypeScript's
//! regular expressions read them.

use kentos_geometry_core::api::json::{ToJson, write_str};
use kentos_geometry_core::jsmath::{PI, cos, js_max, js_min, js_round, sin, tan};
use kentos_style_core::js::number;
use kentos_style_core::js::text::{is_space, slice, trim};

use crate::path::{IDENTITY, Matrix, multiply, number_len};

// ── JavaScript's reading of numbers ────────────────────────────────────

/// `Number(s)` for text: the whole text (white space trimmed) as a decimal,
/// hexadecimal, octal or binary literal or ±Infinity; "" is 0; NaN otherwise.
pub fn js_number(s: &str) -> f64 {
    let t = trim(s);
    if t.is_empty() {
        return 0.0;
    }
    let (sign, body) = match t.as_bytes()[0] {
        b'+' => (1.0, &t[1..]),
        b'-' => (-1.0, &t[1..]),
        _ => (1.0, t),
    };
    if body == "Infinity" {
        return sign * f64::INFINITY;
    }
    let b = body.as_bytes();
    if b.len() > 2 && b[0] == b'0' && sign == 1.0 && t.as_bytes()[0] != b'+' {
        let radix = match b[1] {
            b'x' | b'X' => 16,
            b'o' | b'O' => 8,
            b'b' | b'B' => 2,
            _ => 0,
        };
        if radix != 0 {
            let digits: Option<Vec<u32>> = body[2..].chars().map(|c| c.to_digit(radix)).collect();
            return digits.map_or(f64::NAN, |d| whole(&d, radix));
        }
    }
    if number_len(t.as_bytes()) == t.len() {
        t.parse::<f64>().unwrap_or(f64::NAN)
    } else {
        f64::NAN
    }
}

/// `parseFloat(s)`: the longest decimal (or Infinity) at the start, after white space; NaN when none.
pub fn parse_float(s: &str) -> f64 {
    let t = s.trim_start_matches(is_space);
    let b = t.as_bytes();
    let signed = !b.is_empty() && (b[0] == b'+' || b[0] == b'-');
    let rest = if signed { &t[1..] } else { t };
    if rest.starts_with("Infinity") {
        return if signed && b[0] == b'-' {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }
    let n = number_len(b);
    if n == 0 {
        return f64::NAN;
    }
    t[..n].parse::<f64>().unwrap_or(f64::NAN)
}

/// `s.split(re).filter(Boolean)` for a separator class: runs of the class split, empty parts go.
pub fn split_on(s: &str, sep: impl Fn(char) -> bool) -> Vec<&str> {
    s.split(sep).filter(|p| !p.is_empty()).collect()
}

/// `s.split(/\s+/)` (empty parts kept, as at the ends).
pub fn split_ws(s: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut in_space = false;
    for (i, c) in s.char_indices() {
        if is_space(c) {
            if !in_space {
                out.push(&s[start..i]);
                in_space = true;
            }
        } else if in_space {
            start = i;
            in_space = false;
        }
    }
    out.push(if in_space { "" } else { &s[start..] });
    out
}

/// `/\d/`: an ASCII digit.
fn digit(c: char) -> bool {
    c.is_ascii_digit()
}

// ── Colours ────────────────────────────────────────────────────────────

/// CSS colour keywords (CSS Color 4), name then hex.
const NAMED: [(&str, &str); 148] = [
    ("aliceblue", "F0F8FF"),
    ("antiquewhite", "FAEBD7"),
    ("aqua", "00FFFF"),
    ("aquamarine", "7FFFD4"),
    ("azure", "F0FFFF"),
    ("beige", "F5F5DC"),
    ("bisque", "FFE4C4"),
    ("black", "000000"),
    ("blanchedalmond", "FFEBCD"),
    ("blue", "0000FF"),
    ("blueviolet", "8A2BE2"),
    ("brown", "A52A2A"),
    ("burlywood", "DEB887"),
    ("cadetblue", "5F9EA0"),
    ("chartreuse", "7FFF00"),
    ("chocolate", "D2691E"),
    ("coral", "FF7F50"),
    ("cornflowerblue", "6495ED"),
    ("cornsilk", "FFF8DC"),
    ("crimson", "DC143C"),
    ("cyan", "00FFFF"),
    ("darkblue", "00008B"),
    ("darkcyan", "008B8B"),
    ("darkgoldenrod", "B8860B"),
    ("darkgray", "A9A9A9"),
    ("darkgreen", "006400"),
    ("darkgrey", "A9A9A9"),
    ("darkkhaki", "BDB76B"),
    ("darkmagenta", "8B008B"),
    ("darkolivegreen", "556B2F"),
    ("darkorange", "FF8C00"),
    ("darkorchid", "9932CC"),
    ("darkred", "8B0000"),
    ("darksalmon", "E9967A"),
    ("darkseagreen", "8FBC8F"),
    ("darkslateblue", "483D8B"),
    ("darkslategray", "2F4F4F"),
    ("darkslategrey", "2F4F4F"),
    ("darkturquoise", "00CED1"),
    ("darkviolet", "9400D3"),
    ("deeppink", "FF1493"),
    ("deepskyblue", "00BFFF"),
    ("dimgray", "696969"),
    ("dimgrey", "696969"),
    ("dodgerblue", "1E90FF"),
    ("firebrick", "B22222"),
    ("floralwhite", "FFFAF0"),
    ("forestgreen", "228B22"),
    ("fuchsia", "FF00FF"),
    ("gainsboro", "DCDCDC"),
    ("ghostwhite", "F8F8FF"),
    ("gold", "FFD700"),
    ("goldenrod", "DAA520"),
    ("gray", "808080"),
    ("green", "008000"),
    ("greenyellow", "ADFF2F"),
    ("grey", "808080"),
    ("honeydew", "F0FFF0"),
    ("hotpink", "FF69B4"),
    ("indianred", "CD5C5C"),
    ("indigo", "4B0082"),
    ("ivory", "FFFFF0"),
    ("khaki", "F0E68C"),
    ("lavender", "E6E6FA"),
    ("lavenderblush", "FFF0F5"),
    ("lawngreen", "7CFC00"),
    ("lemonchiffon", "FFFACD"),
    ("lightblue", "ADD8E6"),
    ("lightcoral", "F08080"),
    ("lightcyan", "E0FFFF"),
    ("lightgoldenrodyellow", "FAFAD2"),
    ("lightgray", "D3D3D3"),
    ("lightgreen", "90EE90"),
    ("lightgrey", "D3D3D3"),
    ("lightpink", "FFB6C1"),
    ("lightsalmon", "FFA07A"),
    ("lightseagreen", "20B2AA"),
    ("lightskyblue", "87CEFA"),
    ("lightslategray", "778899"),
    ("lightslategrey", "778899"),
    ("lightsteelblue", "B0C4DE"),
    ("lightyellow", "FFFFE0"),
    ("lime", "00FF00"),
    ("limegreen", "32CD32"),
    ("linen", "FAF0E6"),
    ("magenta", "FF00FF"),
    ("maroon", "800000"),
    ("mediumaquamarine", "66CDAA"),
    ("mediumblue", "0000CD"),
    ("mediumorchid", "BA55D3"),
    ("mediumpurple", "9370DB"),
    ("mediumseagreen", "3CB371"),
    ("mediumslateblue", "7B68EE"),
    ("mediumspringgreen", "00FA9A"),
    ("mediumturquoise", "48D1CC"),
    ("mediumvioletred", "C71585"),
    ("midnightblue", "191970"),
    ("mintcream", "F5FFFA"),
    ("mistyrose", "FFE4E1"),
    ("moccasin", "FFE4B5"),
    ("navajowhite", "FFDEAD"),
    ("navy", "000080"),
    ("oldlace", "FDF5E6"),
    ("olive", "808000"),
    ("olivedrab", "6B8E23"),
    ("orange", "FFA500"),
    ("orangered", "FF4500"),
    ("orchid", "DA70D6"),
    ("palegoldenrod", "EEE8AA"),
    ("palegreen", "98FB98"),
    ("paleturquoise", "AFEEEE"),
    ("palevioletred", "DB7093"),
    ("papayawhip", "FFEFD5"),
    ("peachpuff", "FFDAB9"),
    ("peru", "CD853F"),
    ("pink", "FFC0CB"),
    ("plum", "DDA0DD"),
    ("powderblue", "B0E0E6"),
    ("purple", "800080"),
    ("rebeccapurple", "663399"),
    ("red", "FF0000"),
    ("rosybrown", "BC8F8F"),
    ("royalblue", "4169E1"),
    ("saddlebrown", "8B4513"),
    ("salmon", "FA8072"),
    ("sandybrown", "F4A460"),
    ("seagreen", "2E8B57"),
    ("seashell", "FFF5EE"),
    ("sienna", "A0522D"),
    ("silver", "C0C0C0"),
    ("skyblue", "87CEEB"),
    ("slateblue", "6A5ACD"),
    ("slategray", "708090"),
    ("slategrey", "708090"),
    ("snow", "FFFAFA"),
    ("springgreen", "00FF7F"),
    ("steelblue", "4682B4"),
    ("tan", "D2B48C"),
    ("teal", "008080"),
    ("thistle", "D8BFD8"),
    ("tomato", "FF6347"),
    ("turquoise", "40E0D0"),
    ("violet", "EE82EE"),
    ("wheat", "F5DEB3"),
    ("white", "FFFFFF"),
    ("whitesmoke", "F5F5F5"),
    ("yellow", "FFFF00"),
    ("yellowgreen", "9ACD32"),
];

/// A colour as hex (#RRGGBB) and alpha.
#[derive(Clone, Debug, PartialEq)]
pub struct Color {
    pub hex: String,
    pub alpha: f64,
}

kentos_geometry_core::json_struct!(Color { hex, alpha });

/// Two hex digits of a channel (0–255, rounded; NaN writes "NAN" as JavaScript does).
pub fn hex2(v: f64) -> String {
    let r = js_round(js_max(0.0, js_min(255.0, v)));
    if r.is_nan() {
        return "NAN".into();
    }
    format!("{:02X}", r as u32)
}

pub fn clamp01(v: f64) -> f64 {
    js_max(0.0, js_min(1.0, v))
}

/// Every number written in `v` (`/[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/g`).
pub fn nums(v: Option<&str>) -> Vec<f64> {
    let Some(v) = v else { return Vec::new() };
    let s = v.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < s.len() {
        let n = number_len(&s[i..]);
        if n > 0 {
            out.push(v[i..i + n].parse::<f64>().unwrap_or(f64::NAN));
            i += n;
        } else {
            i += 1;
        }
    }
    out
}

fn hsl(h: f64, s: f64, l: f64) -> [f64; 3] {
    let k = |n: f64| (n + h / 30.0) % 12.0;
    let a = s * js_min(l, 1.0 - l);
    let f = |n: f64| l - a * js_max(-1.0, js_min(js_min(k(n) - 3.0, 9.0 - k(n)), 1.0));
    [f(0.0) * 255.0, f(8.0) * 255.0, f(4.0) * 255.0]
}

fn hex_digits(s: &str) -> bool {
    s.bytes()
        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

/// A CSS colour as hex (#RRGGBB) and alpha; None when it is not a colour.
pub fn read_color(v: &str) -> Option<Color> {
    let s = trim(v).to_lowercase();
    if let Some(d) = s.strip_prefix('#')
        && (d.len() == 3 || d.len() == 4)
        && hex_digits(d)
    {
        let b = d.as_bytes();
        let hex: String = format!(
            "#{0}{0}{1}{1}{2}{2}",
            b[0] as char, b[1] as char, b[2] as char
        )
        .to_uppercase();
        let alpha = if d.len() == 4 {
            u32::from_str_radix(&format!("{0}{0}", b[3] as char), 16).unwrap_or(0) as f64 / 255.0
        } else {
            1.0
        };
        return Some(Color { hex, alpha });
    }
    if let Some(d) = s.strip_prefix('#')
        && (d.len() == 6 || d.len() == 8)
        && hex_digits(d)
    {
        let alpha = if d.len() == 8 {
            u32::from_str_radix(&d[6..], 16).unwrap_or(0) as f64 / 255.0
        } else {
            1.0
        };
        return Some(Color {
            hex: format!("#{}", d[..6].to_uppercase()),
            alpha,
        });
    }
    if let Some(&(_, hex)) = NAMED.iter().find(|(n, _)| *n == s) {
        return Some(Color {
            hex: format!("#{hex}"),
            alpha: 1.0,
        });
    }
    // `^(rgba?|hsla?)\(([^)]*)\)$`
    let (func, args) = ["rgba(", "rgb(", "hsla(", "hsl("]
        .iter()
        .find_map(|f| s.strip_prefix(f).map(|rest| (*f, rest)))?;
    let inner = args.strip_suffix(')')?;
    if inner.contains(')') {
        return None;
    }
    let parts = split_on(inner, |c| is_space(c) || c == ',' || c == '/');
    if parts.len() < 3 {
        return None;
    }
    let pct = |t: &str, full: f64| {
        if t.ends_with('%') {
            (parse_float(t) * full) / 100.0
        } else {
            parse_float(t)
        }
    };
    let alpha = match parts.get(3) {
        None => 1.0,
        Some(p) => clamp01(pct(p, 1.0)),
    };
    let rgb = if func.starts_with("rgb") {
        [
            pct(parts[0], 255.0),
            pct(parts[1], 255.0),
            pct(parts[2], 255.0),
        ]
    } else {
        hsl(
            ((parse_float(parts[0]) % 360.0) + 360.0) % 360.0,
            clamp01(parse_float(parts[1]) / 100.0),
            clamp01(parse_float(parts[2]) / 100.0),
        )
    };
    if rgb.iter().any(|c| !c.is_finite()) {
        return None;
    }
    Some(Color {
        hex: format!("#{}{}{}", hex2(rgb[0]), hex2(rgb[1]), hex2(rgb[2])),
        alpha,
    })
}

/// A paint once references are followed: none, the symbol's colours or a colour.
#[derive(Clone, Debug, PartialEq)]
pub enum Flat {
    None,
    Fill,
    Stroke,
    Color(Color),
}

/// A paint as written, before references are followed: a plain paint, or
/// references (each one's fallback the next) ending in an optional plain
/// paint. A chain, not nested fallbacks, so a long one never recurses.
#[derive(Clone, Debug, PartialEq)]
pub enum RawPaint {
    Plain(Flat),
    Url {
        ids: Vec<String>,
        fallback: Option<Flat>,
    },
}

/// `^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)\s*(.*)$` (case-insensitive): the id and what follows.
fn url_ref(s: &str) -> Option<(String, &str)> {
    if !s.get(..4).is_some_and(|p| p.eq_ignore_ascii_case("url(")) {
        return None;
    }
    let mut r = s[4..].trim_start_matches(is_space);
    if r.starts_with('\'') || r.starts_with('"') {
        r = &r[1..];
    }
    r = r.strip_prefix('#')?;
    let id_len: usize = r
        .char_indices()
        .find(|&(_, c)| c == '\'' || c == '"' || c == ')' || is_space(c))
        .map_or(r.len(), |(k, _)| k);
    if id_len == 0 {
        return None;
    }
    let id = r[..id_len].to_string();
    let mut r = &r[id_len..];
    if r.starts_with('\'') || r.starts_with('"') {
        r = &r[1..];
    }
    r = r.trim_start_matches(is_space);
    r = r.strip_prefix(')')?;
    r = r.trim_start_matches(is_space);
    // `.` does not match line terminators: the tail must be one line.
    if r.contains(['\n', '\r', '\u{2028}', '\u{2029}']) {
        return None;
    }
    Some((id, r))
}

/// One level of `rawPaint`: nothing, a plain paint, or a reference and the text after it.
enum Step<'a> {
    Undefined,
    Plain(Flat),
    Url(String, &'a str),
}

fn paint_step(v: &str) -> Step<'_> {
    let s = trim(v);
    let low = s.to_lowercase();
    if s.is_empty() || low == "inherit" {
        return Step::Undefined;
    }
    if low == "none" || low == "transparent" {
        return Step::Plain(Flat::None);
    }
    if low == "currentcolor" || low.starts_with("param(fill") {
        return Step::Plain(Flat::Fill);
    }
    if low.starts_with("param(stroke") {
        return Step::Plain(Flat::Stroke);
    }
    if let Some((id, tail)) = url_ref(s) {
        return Step::Url(id, tail);
    }
    if low.starts_with("url(") {
        return Step::Plain(Flat::None);
    }
    match read_color(s) {
        Some(c) => Step::Plain(Flat::Color(c)),
        None => Step::Undefined,
    }
}

/// A paint value as written; None when it says nothing (empty, `inherit`, unreadable).
pub fn raw_paint(v: Option<&str>) -> Option<RawPaint> {
    let mut ids = Vec::new();
    let mut text = v?;
    loop {
        match paint_step(text) {
            Step::Url(id, tail) => {
                ids.push(id);
                if tail.is_empty() {
                    return Some(RawPaint::Url {
                        ids,
                        fallback: None,
                    });
                }
                text = tail;
            }
            Step::Plain(p) if ids.is_empty() => return Some(RawPaint::Plain(p)),
            Step::Plain(p) => {
                return Some(RawPaint::Url {
                    ids,
                    fallback: Some(p),
                });
            }
            Step::Undefined if ids.is_empty() => return None,
            Step::Undefined => {
                return Some(RawPaint::Url {
                    ids,
                    fallback: None,
                });
            }
        }
    }
}

pub fn with_alpha(hex: &str, alpha: f64) -> String {
    if alpha < 0.999 {
        format!("{hex}{}", hex2(alpha * 255.0))
    } else {
        hex.to_string()
    }
}

/// `parseInt(s, 16)`: white space, a sign and a `0x` prefix skipped, then
/// the leading hex digits; NaN when there are none.
pub fn parse_hex(s: &str) -> f64 {
    let t = s.trim_start_matches(is_space);
    let (sign, t) = match t.as_bytes().first() {
        Some(b'-') => (-1.0, &t[1..]),
        Some(b'+') => (1.0, &t[1..]),
        _ => (1.0, t),
    };
    let t = t
        .strip_prefix("0x")
        .or_else(|| t.strip_prefix("0X"))
        .unwrap_or(t);
    let digits: Vec<u32> = t.chars().map_while(|c| c.to_digit(16)).collect();
    if digits.is_empty() {
        return f64::NAN;
    }
    sign * whole(&digits, 16)
}

/// The integer written by `digits` in `radix`, rounded once to the nearest
/// double (as JavaScript reads a hexadecimal literal).
fn whole(digits: &[u32], radix: u32) -> f64 {
    let mut v: u128 = 0;
    for (k, &d) in digits.iter().enumerate() {
        match v
            .checked_mul(u128::from(radix))
            .and_then(|x| x.checked_add(u128::from(d)))
        {
            Some(x) => v = x,
            // Beyond 2¹²⁸ the double is the leading digits scaled: exact enough to round once.
            None => {
                let mut f = v as f64;
                for &d in &digits[k..] {
                    f = f * f64::from(radix) + f64::from(d);
                }
                return f;
            }
        }
    }
    v as f64
}

/// Near-black colours (the "black" of icon sets: #000, #1D1D1B, #231F20 …) that become the symbol colour.
pub fn is_near_black(hex: &str) -> bool {
    let r = parse_hex(&slice(hex, 1, Some(3)));
    let g = parse_hex(&slice(hex, 3, Some(5)));
    let b = parse_hex(&slice(hex, 5, Some(7)));
    js_max(js_max(r, g), b) <= 48.0
}

/// A paint value as the model's paint (black is the symbol colour); None when it cannot be read.
pub fn read_paint(v: Option<&str>) -> Option<String> {
    match raw_paint(v)? {
        RawPaint::Url { .. } => None,
        RawPaint::Plain(p) => Some(match p {
            Flat::None => "none".into(),
            Flat::Fill => "fill".into(),
            Flat::Stroke => "stroke".into(),
            Flat::Color(c) if c.hex == "#000000" && c.alpha >= 0.999 => "fill".into(),
            Flat::Color(c) => with_alpha(&c.hex, c.alpha),
        }),
    }
}

// ── Transforms and lengths ─────────────────────────────────────────────

const FUNCS: [&str; 6] = ["matrix", "translate", "scale", "rotate", "skewX", "skewY"];

/// The transform attribute as a matrix (functions applied left to right, as SVG does).
pub fn read_transform(v: Option<&str>) -> Matrix {
    let Some(v) = v.filter(|v| !v.is_empty()) else {
        return IDENTITY;
    };
    let mut m = IDENTITY;
    let mut i = 0;
    // `/(matrix|…|skewY)\s*\(([^)]*)\)/g`: a match anywhere, then on after it.
    while i < v.len() {
        let hit = FUNCS.iter().find_map(|f| {
            let rest = v.get(i..)?.strip_prefix(f)?;
            let rest = rest.trim_start_matches(is_space);
            let inner = rest.strip_prefix('(')?;
            let close = inner.find(')')?;
            let end = v.len() - inner.len() + close + 1;
            Some((*f, &inner[..close], end))
        });
        let Some((f, args, end)) = hit else {
            i += v[i..].chars().next().map_or(1, char::len_utf8);
            continue;
        };
        let a = nums(Some(args));
        let get = |k: usize, d: f64| a.get(k).copied().unwrap_or(d);
        let t: Matrix = match f {
            "matrix" if a.len() == 6 => [a[0], a[1], a[2], a[3], a[4], a[5]],
            "translate" => [1.0, 0.0, 0.0, 1.0, get(0, 0.0), get(1, 0.0)],
            "scale" => [
                get(0, 1.0),
                0.0,
                0.0,
                a.get(1).copied().unwrap_or(get(0, 1.0)),
                0.0,
                0.0,
            ],
            "rotate" => {
                let r = (get(0, 0.0) * PI) / 180.0;
                let c = cos(r);
                let s = sin(r);
                let cx = get(1, 0.0);
                let cy = get(2, 0.0);
                [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]
            }
            "skewX" => [1.0, 0.0, tan((get(0, 0.0) * PI) / 180.0), 1.0, 0.0, 0.0],
            "skewY" => [1.0, tan((get(0, 0.0) * PI) / 180.0), 0.0, 1.0, 0.0, 0.0],
            _ => IDENTITY,
        };
        m = multiply(&m, &t);
        i = end;
    }
    m
}

/// Pixels per unit (CSS: 96 px to the inch).
pub fn px_per(unit: &str) -> Option<f64> {
    Some(match unit {
        "" | "px" => 1.0,
        "mm" => 96.0 / 25.4,
        "cm" => 96.0 / 2.54,
        "in" => 96.0,
        "pt" => 96.0 / 72.0,
        "pc" => 16.0,
        "q" => 96.0 / 101.6,
        _ => return None,
    })
}

const UNITS: [&str; 11] = [
    "px", "mm", "cm", "in", "pt", "pc", "q", "em", "ex", "rem", "%",
];

/// A length: its number and unit (lower case; "" for none).
#[derive(Clone, Debug, PartialEq)]
pub struct Length {
    pub value: f64,
    pub unit: String,
}

pub fn parse_length(v: Option<&str>) -> Option<Length> {
    let v = v.unwrap_or("");
    let t = v.trim_start_matches(is_space);
    let n = number_len(t.as_bytes());
    if n == 0 {
        return None;
    }
    let value = t[..n].parse::<f64>().unwrap_or(f64::NAN);
    let rest = t[n..].trim_start_matches(is_space);
    let (unit, rest) = match UNITS.iter().find(|u| {
        rest.len() >= u.len()
            && rest.is_char_boundary(u.len())
            && rest[..u.len()].eq_ignore_ascii_case(u)
    }) {
        Some(u) => (u.to_string(), &rest[u.len()..]),
        None => (String::new(), rest),
    };
    if !rest.chars().all(is_space) {
        return None;
    }
    Some(Length { value, unit })
}

/// A length in user units; % against `percent`, em against `em`.
pub fn to_user(v: Option<&str>, percent: f64, em: f64) -> Option<f64> {
    let l = parse_length(v)?;
    Some(match l.unit.as_str() {
        "%" => (l.value * percent) / 100.0,
        "em" | "rem" => l.value * em,
        "ex" => l.value * em * 0.5,
        u => l.value * px_per(u).unwrap_or(1.0),
    })
}

/// The viewBox → viewport map with preserveAspectRatio (SVG 1.1 §7.8).
pub fn view_box_transform(vb: &[f64], width: f64, height: f64, par: &str) -> Matrix {
    let get = |k: usize| vb.get(k).copied().unwrap_or(f64::NAN);
    let (x, y, w, h) = (get(0), get(1), get(2), get(3));
    let words: Vec<&str> = split_ws(trim(par))
        .into_iter()
        .filter(|t| !t.is_empty() && *t != "defer")
        .collect();
    let align = words.first().copied().unwrap_or("xMidYMid");
    let mut sx = width / w;
    let mut sy = height / h;
    let mut tx = 0.0;
    let mut ty = 0.0;
    if align != "none" {
        let s = if words.get(1) == Some(&"slice") {
            js_max(sx, sy)
        } else {
            js_min(sx, sy)
        };
        sx = s;
        sy = s;
        let ax = if align.contains("xMid") {
            0.5
        } else if align.contains("xMax") {
            1.0
        } else {
            0.0
        };
        let ay = if align.contains("YMid") {
            0.5
        } else if align.contains("YMax") {
            1.0
        } else {
            0.0
        };
        tx = (width - w * s) * ax;
        ty = (height - h * s) * ay;
    }
    [sx, 0.0, 0.0, sy, tx - x * sx, ty - y * sy]
}

pub fn view_box_of(v: Option<&str>) -> Option<Vec<f64>> {
    let a = nums(v);
    (a.len() == 4 && a[2] > 0.0 && a[3] > 0.0).then_some(a)
}

// ── CSS ────────────────────────────────────────────────────────────────

/// An element as the importer reads it (the page parses the XML). The
/// nodes of a file sit in one list (`XmlTree`): a node is its index there,
/// as the TypeScript told nodes apart by identity.
#[derive(Clone, Debug, PartialEq)]
pub struct XmlNode {
    pub tag: String,
    /// Attributes in the file's order.
    pub attrs: Vec<(String, String)>,
    pub children: Vec<usize>,
    /// Text content: of a text element (without children), of a `#text` node, of a `<style>`.
    pub text: Option<String>,
}

impl XmlNode {
    pub fn attr(&self, k: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(n, _)| n == k)
            .map(|(_, v)| v.as_str())
    }

    /// Whether the element has the attribute (its own: the TypeScript's
    /// `name in attrs` also found `constructor`, `toString` … on every
    /// element, docs/adr/0008 “SVG düzenleyicisi”).
    pub fn has(&self, k: &str) -> bool {
        self.attrs.iter().any(|(n, _)| n == k)
    }
}

/// Element `i` of a JSON array; null when absent.
fn item_at(
    v: &kentos_geometry_core::api::json::Json,
    i: usize,
) -> &kentos_geometry_core::api::json::Json {
    use kentos_geometry_core::api::json::Json;
    const NULL: Json = Json::Null;
    match v {
        Json::Arr(a) => a.get(i).unwrap_or(&NULL),
        _ => &NULL,
    }
}

/// A file's elements, root first (index 0). It crosses flat, each node as
/// `[tag, attributes, text | null, parent index]` in document order, so a
/// deep file is no deep JSON.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct XmlTree {
    pub nodes: Vec<XmlNode>,
}

impl kentos_geometry_core::api::json::FromJson for XmlTree {
    fn from_json(v: &kentos_geometry_core::api::json::Json) -> Result<XmlTree, String> {
        use kentos_geometry_core::api::json::Json;
        let text_of = |j: &Json| match j {
            Json::Str(s) => s.clone(),
            Json::Num(x) => number::to_string(*x),
            Json::Bool(b) => b.to_string(),
            _ => String::new(),
        };
        let Json::Arr(items) = v else {
            return Err("düğüm listesi bekleniyordu".into());
        };
        let mut nodes: Vec<XmlNode> = Vec::with_capacity(items.len());
        for (i, item) in items.iter().enumerate() {
            let parent = match item_at(item, 3) {
                Json::Num(p) if *p >= 0.0 && (*p as usize) < i && p.fract() == 0.0 => {
                    Some(*p as usize)
                }
                _ if i == 0 => None,
                _ => return Err(format!("{i}. düğümün üst düğümü yok")),
            };
            nodes.push(XmlNode {
                tag: text_of(item_at(item, 0)),
                attrs: match item_at(item, 1) {
                    Json::Obj(f) => f.iter().map(|(k, x)| (k.clone(), text_of(x))).collect(),
                    _ => Vec::new(),
                },
                children: Vec::new(),
                text: match item_at(item, 2) {
                    Json::Null => None,
                    t => Some(text_of(t)),
                },
            });
            if let Some(p) = parent {
                nodes[p].children.push(i);
            }
        }
        if nodes.is_empty() {
            return Err("boş düğüm listesi".into());
        }
        Ok(XmlTree { nodes })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Compound {
    pub tag: Option<String>,
    pub id: Option<String>,
    pub classes: Vec<String>,
    pub attrs: Vec<(String, Option<String>)>,
    /// The id was named before the tag (the order the TypeScript object held them in).
    pub id_first: bool,
}

impl ToJson for Compound {
    fn write_json(&self, out: &mut String) {
        out.push_str("{\"classes\":");
        self.classes.write_json(out);
        out.push_str(",\"attrs\":[");
        for (i, (name, value)) in self.attrs.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            out.push_str("{\"name\":");
            write_str(out, name);
            if let Some(v) = value {
                out.push_str(",\"value\":");
                write_str(out, v);
            }
            out.push('}');
        }
        out.push(']');
        let named = [("tag", &self.tag), ("id", &self.id)];
        let order: [usize; 2] = if self.id_first { [1, 0] } else { [0, 1] };
        for k in order {
            if let (name, Some(v)) = named[k] {
                out.push_str(&format!(",\"{name}\":"));
                write_str(out, v);
            }
        }
        out.push('}');
    }
}

impl ToJson for Selector {
    fn write_json(&self, out: &mut String) {
        out.push_str("{\"parts\":[");
        for (i, (c, child)) in self.parts.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            out.push_str("{\"c\":");
            c.write_json(out);
            out.push_str(",\"child\":");
            child.write_json(out);
            out.push('}');
        }
        out.push_str("],\"spec\":");
        self.spec.write_json(out);
        out.push('}');
    }
}

/// Right to left: the element itself first, then its ancestors with the combinator between.
#[derive(Clone, Debug, PartialEq)]
pub struct Selector {
    pub parts: Vec<(Compound, bool)>,
    pub spec: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Decl {
    pub prop: String,
    pub value: String,
    pub important: bool,
}

kentos_geometry_core::json_struct!(out Decl { prop, value, important });
kentos_geometry_core::json_struct!(out Rule { selectors, decls, order });
kentos_geometry_core::json_struct!(out Length { value, unit });

#[derive(Clone, Debug, PartialEq)]
pub struct Rule {
    pub selectors: Vec<Selector>,
    pub decls: Vec<Decl>,
    pub order: f64,
}

/// `/!\s*important\s*$/i`: where the leftmost such tail starts.
fn important_at(value: &str) -> Option<usize> {
    for (i, c) in value.char_indices() {
        if c != '!' {
            continue;
        }
        let r = value[1 + i..].trim_start_matches(is_space);
        if r.len() >= 9
            && r.is_char_boundary(9)
            && r[..9].eq_ignore_ascii_case("important")
            && r[9..].chars().all(is_space)
        {
            return Some(i);
        }
    }
    None
}

pub fn parse_decls(text: &str) -> Vec<Decl> {
    let mut out = Vec::new();
    for decl in text.split(';') {
        let Some(i) = decl.find(':') else { continue };
        if i == 0 {
            continue;
        }
        let mut value = trim(&decl[i + 1..]).to_string();
        let important = match important_at(&value) {
            Some(at) => {
                value = trim(&value[..at]).to_string();
                true
            }
            None => false,
        };
        out.push(Decl {
            prop: trim(&decl[..i]).to_lowercase(),
            value,
            important,
        });
    }
    out
}

fn word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// One compound selector's token (no white space inside): its parts, or None when it is not one this reads.
fn compound(t: &str, spec: &mut f64) -> Option<Compound> {
    let mut c = Compound {
        tag: None,
        id: None,
        classes: Vec::new(),
        attrs: Vec::new(),
        id_first: false,
    };
    let s: Vec<char> = t.chars().collect();
    let mut i = 0;
    while i < s.len() {
        // `([#.]?)(-?[_a-zA-Z][\w-]*)`
        let mut k = i;
        let prefix = if s[k] == '#' || s[k] == '.' {
            k += 1;
            Some(s[i])
        } else {
            None
        };
        let start = k;
        if k < s.len() && s[k] == '-' {
            k += 1;
        }
        if k < s.len() && (s[k] == '_' || s[k].is_ascii_alphabetic()) {
            k += 1;
            while k < s.len() && (word_char(s[k]) || s[k] == '-') {
                k += 1;
            }
            let name: String = s[start..k].iter().collect();
            match prefix {
                Some('#') => {
                    c.id_first |= c.tag.is_none() && c.id.is_none();
                    c.id = Some(name);
                    *spec += 10000.0;
                }
                Some(_) => {
                    c.classes.push(name);
                    *spec += 100.0;
                }
                None => {
                    c.tag = Some(name.to_lowercase());
                    *spec += 1.0;
                }
            }
            i = k;
            continue;
        }
        // `\[\s*([\w:-]+)\s*(?:=\s*["']?([^"'\]]*)["']?)?\s*\]`
        if s[i] == '[' {
            let mut k = i + 1;
            let n0 = k;
            while k < s.len() && (word_char(s[k]) || s[k] == ':' || s[k] == '-') {
                k += 1;
            }
            if k > n0 {
                let name: String = s[n0..k].iter().collect();
                let mut value = None;
                let mut ok = true;
                if k < s.len() && s[k] == '=' {
                    let mut j = k + 1;
                    if j < s.len() && (s[j] == '"' || s[j] == '\'') {
                        j += 1;
                    }
                    let v0 = j;
                    while j < s.len() && s[j] != '"' && s[j] != '\'' && s[j] != ']' {
                        j += 1;
                    }
                    let v: String = s[v0..j].iter().collect();
                    if j < s.len() && (s[j] == '"' || s[j] == '\'') {
                        j += 1;
                    }
                    if j < s.len() && s[j] == ']' {
                        value = Some(v);
                        k = j;
                    } else {
                        ok = false;
                    }
                }
                if ok && k < s.len() && s[k] == ']' {
                    c.attrs.push((name, value));
                    *spec += 100.0;
                    i = k + 1;
                    continue;
                }
            }
            return None;
        }
        if s[i] == '*' {
            i += 1;
            continue;
        }
        return None;
    }
    Some(c)
}

fn parse_selector(text: &str) -> Option<Selector> {
    // `.replace(/\s*>\s*/g, ' > ').split(/\s+/)`: '>' stands alone.
    let spaced: String = {
        let t = trim(text);
        let mut out = String::new();
        for c in t.chars() {
            if c == '>' {
                while out.ends_with(is_space) {
                    out.pop();
                }
                out.push_str(" > ");
            } else if is_space(c) && out.ends_with("> ") {
                continue;
            } else {
                out.push(c);
            }
        }
        out
    };
    let tokens: Vec<&str> = split_ws(&spaced)
        .into_iter()
        .filter(|t| !t.is_empty())
        .collect();
    let mut parts: Vec<(Compound, bool)> = Vec::new();
    let mut spec = 0.0;
    let mut child = false;
    for t in tokens {
        if t == ">" {
            child = true;
            continue;
        }
        if t.contains(['+', '~', ':']) {
            return None;
        }
        let c = compound(t, &mut spec)?;
        parts.insert(0, (c, false));
        if parts.len() > 1 {
            parts[1].1 = child;
        }
        child = false;
    }
    (!parts.is_empty()).then_some(Selector { parts, spec })
}

/// `text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--|-->/g, '')`.
fn strip_comments(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(i) = rest.find("/*") {
        match rest[i + 2..].find("*/") {
            Some(j) => {
                out.push_str(&rest[..i]);
                rest = &rest[i + 2 + j + 2..];
            }
            None => break,
        }
    }
    out.push_str(rest);
    // `/<!--|-->/g` in one pass: what a removal joins is not looked at again.
    let mut clean = String::with_capacity(out.len());
    let mut rest = out.as_str();
    while !rest.is_empty() {
        if let Some(r) = rest
            .strip_prefix("<!--")
            .or_else(|| rest.strip_prefix("-->"))
        {
            rest = r;
        } else {
            let c = rest.chars().next().unwrap_or_default();
            clean.push(c);
            rest = &rest[c.len_utf8()..];
        }
    }
    clean
}

/// Rules of a style sheet; at-rule blocks (@media, @font-face …) are left out.
pub fn parse_css(text: &str, order_from: f64) -> Vec<Rule> {
    let src: Vec<char> = strip_comments(text).chars().collect();
    let mut rules = Vec::new();
    let mut i = 0;
    let mut order = order_from;
    while i < src.len() {
        let Some(open) = src[i..].iter().position(|&c| c == '{').map(|k| k + i) else {
            break;
        };
        let head: String = src[i..open].iter().collect();
        let head = trim(&head).to_string();
        // Find the matching close brace (at-rules may nest).
        let mut depth = 1;
        let mut j = open + 1;
        while j < src.len() && depth > 0 {
            if src[j] == '{' {
                depth += 1;
            } else if src[j] == '}' {
                depth -= 1;
            }
            j += 1;
        }
        let body: String = if j > open + 1 {
            src[open + 1..j - 1].iter().collect()
        } else {
            String::new()
        };
        i = j;
        if head.starts_with('@') {
            continue;
        }
        let selectors: Vec<Selector> = head.split(',').filter_map(parse_selector).collect();
        if !selectors.is_empty() {
            rules.push(Rule {
                selectors,
                decls: parse_decls(&body),
                order,
            });
            order += 1.0;
        }
    }
    rules
}

fn match_compound(c: &Compound, n: &XmlNode) -> bool {
    if let Some(t) = c.tag.as_deref().filter(|t| !t.is_empty())
        && n.tag.to_lowercase() != t
    {
        return false;
    }
    if let Some(id) = c.id.as_deref().filter(|t| !t.is_empty())
        && n.attr("id") != Some(id)
    {
        return false;
    }
    if !c.classes.is_empty() {
        let cls = split_ws(n.attr("class").unwrap_or(""));
        if !c.classes.iter().all(|k| cls.contains(&k.as_str())) {
            return false;
        }
    }
    c.attrs.iter().all(|(name, value)| match value {
        None => n.has(name),
        Some(v) => n.attr(name) == Some(v.as_str()),
    })
}

/// Does the selector match node `n` whose ancestors are `path` (root first)?
pub fn matches(sel: &Selector, nodes: &[XmlNode], n: usize, path: &[usize]) -> bool {
    if !match_compound(&sel.parts[0].0, &nodes[n]) {
        return false;
    }
    let mut at = path.len();
    for k in 1..sel.parts.len() {
        let c = &sel.parts[k].0;
        let child = sel.parts[k - 1].1;
        if child {
            if at == 0 || !match_compound(c, &nodes[path[at - 1]]) {
                return false;
            }
            at -= 1;
        } else {
            while at > 0 && !match_compound(c, &nodes[path[at - 1]]) {
                at -= 1;
            }
            if at == 0 {
                return false;
            }
            at -= 1;
        }
    }
    true
}

/// Properties read from presentation attributes, rules and `style`.
pub const PROPS: [&str; 26] = [
    "fill",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "fill-opacity",
    "opacity",
    "stroke-dasharray",
    "stroke-linecap",
    "stroke-linejoin",
    "fill-rule",
    "font-size",
    "font-family",
    "font-weight",
    "text-anchor",
    "display",
    "visibility",
    "color",
    "clip-path",
    "mask",
    "filter",
    "stop-color",
    "stop-opacity",
    "marker-start",
    "marker-mid",
    "marker-end",
    "marker",
];

/// `/\d/.test(first char)`.
pub fn starts_with_digit(s: &str) -> bool {
    s.chars().next().is_some_and(digit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use kentos_geometry_core::api::json::{FromJson, Json};

    fn same(a: f64, b: f64) -> bool {
        a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan())
    }

    #[test]
    fn numbers_read_as_javascript_reads_them() {
        for (text, want) in [
            ("0x1F", 31.0),
            ("0b101", 5.0),
            ("-0x1F", f64::NAN),
            ("+0x1F", f64::NAN),
            (" 12 ", 12.0),
            ("", 0.0),
            ("1e3", 1000.0),
            ("-Infinity", f64::NEG_INFINITY),
            ("infinity", f64::NAN),
            ("1_000", f64::NAN),
            ("0x", f64::NAN),
        ] {
            assert!(
                same(js_number(text), want),
                "Number({text:?}) = {}",
                js_number(text)
            );
        }
        for (text, want) in [
            ("3.5px", 3.5),
            ("-.5e2x", -50.0),
            ("1e", 1.0),
            ("x", f64::NAN),
            ("  -Infinityx", f64::NEG_INFINITY),
            ("0x10", 0.0),
        ] {
            assert!(
                same(parse_float(text), want),
                "parseFloat({text:?}) = {}",
                parse_float(text)
            );
        }
        for (text, want) in [
            ("ff", 255.0),
            ("-1", -1.0),
            ("0x1f", 31.0),
            ("0x", f64::NAN),
            ("g", f64::NAN),
            (" 7g", 7.0),
        ] {
            assert!(
                same(parse_hex(text), want),
                "parseInt({text:?}, 16) = {}",
                parse_hex(text)
            );
        }
    }

    #[test]
    fn near_black_slices_code_units_and_reads_signs() {
        assert!(is_near_black("#1D1D1B"));
        assert!(!is_near_black("#313131"));
        // parseInt reads "-1" as −1: the TypeScript took this for black too.
        assert!(is_near_black("#-1-1-1"));
        assert!(!is_near_black("#é10000"));
        assert!(!is_near_black("fill"));
    }

    #[test]
    fn colours_and_paints() {
        assert_eq!(
            read_color("#abc"),
            Some(Color {
                hex: "#AABBCC".into(),
                alpha: 1.0
            })
        );
        assert_eq!(
            read_color("rgb(10% 20% 30% / 0.5)"),
            Some(Color {
                hex: "#1A334D".into(),
                alpha: 0.5
            })
        );
        assert_eq!(
            read_color("hsl(120, 100%, 25%)").map(|c| c.hex),
            Some("#008000".into())
        );
        assert_eq!(read_color("url(#a)"), None);
        // A reference chain: each reference's fallback is the next, then the plain paint.
        let red = Flat::Color(Color {
            hex: "#FF0000".into(),
            alpha: 1.0,
        });
        assert_eq!(
            raw_paint(Some(" url(#a) url('#b')  red ")),
            Some(RawPaint::Url {
                ids: vec!["a".into(), "b".into()],
                fallback: Some(red)
            })
        );
        assert_eq!(
            raw_paint(Some("url(#a) inherit")),
            Some(RawPaint::Url {
                ids: vec!["a".into()],
                fallback: None
            })
        );
        assert_eq!(
            raw_paint(Some("url(foo)")),
            Some(RawPaint::Plain(Flat::None))
        );
        // A tail over two lines does not match `.*$`: the whole value is an unreadable url().
        assert_eq!(
            raw_paint(Some("url(#a) red\nblue")),
            Some(RawPaint::Plain(Flat::None))
        );
        // A non-ASCII character where "url(" would end.
        assert_eq!(raw_paint(Some("ur€(#a)")), None);
        assert_eq!(read_paint(Some("#000")), Some("fill".into()));
        assert_eq!(
            read_paint(Some("rgba(255, 0, 0, 0.5)")),
            Some("#FF000080".into())
        );
    }

    #[test]
    fn style_sheets() {
        // `<!--|-->` is removed in one pass: what a removal joins is not looked at again.
        assert_eq!(strip_comments("-<!--->"), "-->");
        assert_eq!(strip_comments("a /* b */ c /* open"), "a  c /* open");
        let rules = parse_css(
            "#x.k rect > .a, g { fill: red !important; stroke: blue } @media print { .a { fill: none } } a:hover { x: y }",
            3.0,
        );
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].order, 3.0);
        assert_eq!(rules[0].selectors.len(), 2);
        assert_eq!(rules[0].selectors[0].spec, 10000.0 + 100.0 + 1.0 + 100.0);
        assert_eq!(
            rules[0].decls[0],
            Decl {
                prop: "fill".into(),
                value: "red".into(),
                important: true
            }
        );
        // The compound keeps the order its tag and id were named in (the TypeScript object's keys).
        let json = kentos_geometry_core::api::json::to_string(
            &parse_css("#i.c[a] {}", 0.0)[0].selectors[0].parts[0].0,
        );
        assert_eq!(json, r#"{"classes":["c"],"attrs":[{"name":"a"}],"id":"i"}"#);
        let json = kentos_geometry_core::api::json::to_string(
            &parse_css("rect#i {}", 0.0)[0].selectors[0].parts[0].0,
        );
        assert_eq!(json, r#"{"classes":[],"attrs":[],"tag":"rect","id":"i"}"#);
    }

    #[test]
    fn a_file_crosses_flat_and_its_parents_come_first() {
        let tree = XmlTree::from_json(&Json::parse(r##"[["svg",{},null,-1],["g",{"id":"a"},null,0],["#text",{},"x",1],["rect",{},null,0]]"##).unwrap()).unwrap();
        assert_eq!(tree.nodes[0].children, vec![1, 3]);
        assert_eq!(tree.nodes[1].children, vec![2]);
        assert_eq!(tree.nodes[2].text.as_deref(), Some("x"));
        // A parent after its child (or none but for the root) is refused.
        assert!(
            XmlTree::from_json(
                &Json::parse(r#"[["svg",{},null,-1],["g",{},null,2],["g",{},null,1]]"#).unwrap()
            )
            .is_err()
        );
        assert!(
            XmlTree::from_json(&Json::parse(r#"[["svg",{},null,-1],["g",{},null,-1]]"#).unwrap())
                .is_err()
        );
        assert!(XmlTree::from_json(&Json::parse("[]").unwrap()).is_err());
    }
}
