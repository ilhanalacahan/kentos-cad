//! JSON writer for the WASM boundary and the golden fixtures (docs/adr/0008).
//! serde_json writes NaN and ±∞ as `null`, which the TypeScript core never
//! did: a degenerate result would silently turn into a number (null · 2 = 0).
//! This writer keeps them as the strings `"#NaN"`, `"#Inf"` and `"#-Inf"`
//! (`src/wasm/core.ts` turns them back into numbers) and writes every finite
//! number in its shortest round-trip form, so values cross bit for bit.
//! Anything serde derives is supported; map keys must be strings or integers.

use std::fmt::{self, Display, Write};

use serde::ser::{self, Serialize};

#[derive(Debug)]
pub struct Error(pub String);

impl Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

impl ser::Error for Error {
    fn custom<T: Display>(msg: T) -> Self {
        Error(msg.to_string())
    }
}

pub fn to_string<T: Serialize + ?Sized>(value: &T) -> Result<String, String> {
    let mut s = Writer { out: String::new() };
    value.serialize(&mut s).map_err(|e| e.0)?;
    Ok(s.out)
}

pub struct Writer {
    out: String,
}

/// A finite number in the shortest form that reads back to the same bits;
/// exponents outside [1e-6, 1e21), as JavaScript prints them.
pub fn write_number(out: &mut String, x: f64) {
    if x.is_nan() {
        out.push_str("\"#NaN\"");
    } else if x == f64::INFINITY {
        out.push_str("\"#Inf\"");
    } else if x == f64::NEG_INFINITY {
        out.push_str("\"#-Inf\"");
    } else if x == 0.0 {
        out.push_str(if x.is_sign_negative() { "-0" } else { "0" });
    } else {
        let a = x.abs();
        // Writing to a String cannot fail.
        let _ = if (1e-6..1e21).contains(&a) {
            write!(out, "{x}")
        } else {
            write!(out, "{x:e}")
        };
    }
}

fn write_str(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

pub struct Compound<'a> {
    w: &'a mut Writer,
    first: bool,
    /// Closing text: "]" or "}" (and one more "}" for a variant wrapper).
    close: &'static str,
}

impl Compound<'_> {
    fn comma(&mut self) {
        if !self.first {
            self.w.out.push(',');
        }
        self.first = false;
    }
}

impl<'a> ser::Serializer for &'a mut Writer {
    type Ok = ();
    type Error = Error;
    type SerializeSeq = Compound<'a>;
    type SerializeTuple = Compound<'a>;
    type SerializeTupleStruct = Compound<'a>;
    type SerializeTupleVariant = Compound<'a>;
    type SerializeMap = Compound<'a>;
    type SerializeStruct = Compound<'a>;
    type SerializeStructVariant = Compound<'a>;

    fn serialize_bool(self, v: bool) -> Result<(), Error> {
        self.out.push_str(if v { "true" } else { "false" });
        Ok(())
    }
    fn serialize_i8(self, v: i8) -> Result<(), Error> {
        self.serialize_i64(v.into())
    }
    fn serialize_i16(self, v: i16) -> Result<(), Error> {
        self.serialize_i64(v.into())
    }
    fn serialize_i32(self, v: i32) -> Result<(), Error> {
        self.serialize_i64(v.into())
    }
    fn serialize_i64(self, v: i64) -> Result<(), Error> {
        let _ = write!(self.out, "{v}");
        Ok(())
    }
    fn serialize_i128(self, v: i128) -> Result<(), Error> {
        let _ = write!(self.out, "{v}");
        Ok(())
    }
    fn serialize_u8(self, v: u8) -> Result<(), Error> {
        self.serialize_u64(v.into())
    }
    fn serialize_u16(self, v: u16) -> Result<(), Error> {
        self.serialize_u64(v.into())
    }
    fn serialize_u32(self, v: u32) -> Result<(), Error> {
        self.serialize_u64(v.into())
    }
    fn serialize_u64(self, v: u64) -> Result<(), Error> {
        let _ = write!(self.out, "{v}");
        Ok(())
    }
    fn serialize_u128(self, v: u128) -> Result<(), Error> {
        let _ = write!(self.out, "{v}");
        Ok(())
    }
    fn serialize_f32(self, v: f32) -> Result<(), Error> {
        self.serialize_f64(v.into())
    }
    fn serialize_f64(self, v: f64) -> Result<(), Error> {
        write_number(&mut self.out, v);
        Ok(())
    }
    fn serialize_char(self, v: char) -> Result<(), Error> {
        write_str(&mut self.out, v.encode_utf8(&mut [0; 4]));
        Ok(())
    }
    fn serialize_str(self, v: &str) -> Result<(), Error> {
        write_str(&mut self.out, v);
        Ok(())
    }
    fn serialize_bytes(self, v: &[u8]) -> Result<(), Error> {
        use ser::SerializeSeq;
        let mut seq = self.serialize_seq(Some(v.len()))?;
        for b in v {
            seq.serialize_element(b)?;
        }
        seq.end()
    }
    fn serialize_none(self) -> Result<(), Error> {
        self.out.push_str("null");
        Ok(())
    }
    fn serialize_some<T: Serialize + ?Sized>(self, value: &T) -> Result<(), Error> {
        value.serialize(self)
    }
    fn serialize_unit(self) -> Result<(), Error> {
        self.out.push_str("null");
        Ok(())
    }
    fn serialize_unit_struct(self, _name: &'static str) -> Result<(), Error> {
        self.serialize_unit()
    }
    fn serialize_unit_variant(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
    ) -> Result<(), Error> {
        write_str(&mut self.out, variant);
        Ok(())
    }
    fn serialize_newtype_struct<T: Serialize + ?Sized>(
        self,
        _name: &'static str,
        value: &T,
    ) -> Result<(), Error> {
        value.serialize(self)
    }
    fn serialize_newtype_variant<T: Serialize + ?Sized>(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
        value: &T,
    ) -> Result<(), Error> {
        self.out.push('{');
        write_str(&mut self.out, variant);
        self.out.push(':');
        value.serialize(&mut *self)?;
        self.out.push('}');
        Ok(())
    }
    fn serialize_seq(self, _len: Option<usize>) -> Result<Compound<'a>, Error> {
        self.out.push('[');
        Ok(Compound {
            w: self,
            first: true,
            close: "]",
        })
    }
    fn serialize_tuple(self, len: usize) -> Result<Compound<'a>, Error> {
        self.serialize_seq(Some(len))
    }
    fn serialize_tuple_struct(
        self,
        _name: &'static str,
        len: usize,
    ) -> Result<Compound<'a>, Error> {
        self.serialize_seq(Some(len))
    }
    fn serialize_tuple_variant(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
        _len: usize,
    ) -> Result<Compound<'a>, Error> {
        self.out.push('{');
        write_str(&mut self.out, variant);
        self.out.push_str(":[");
        Ok(Compound {
            w: self,
            first: true,
            close: "]}",
        })
    }
    fn serialize_map(self, _len: Option<usize>) -> Result<Compound<'a>, Error> {
        self.out.push('{');
        Ok(Compound {
            w: self,
            first: true,
            close: "}",
        })
    }
    fn serialize_struct(self, _name: &'static str, len: usize) -> Result<Compound<'a>, Error> {
        self.serialize_map(Some(len))
    }
    fn serialize_struct_variant(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
        _len: usize,
    ) -> Result<Compound<'a>, Error> {
        self.out.push('{');
        write_str(&mut self.out, variant);
        self.out.push_str(":{");
        Ok(Compound {
            w: self,
            first: true,
            close: "}}",
        })
    }
}

impl ser::SerializeSeq for Compound<'_> {
    type Ok = ();
    type Error = Error;
    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        self.comma();
        value.serialize(&mut *self.w)
    }
    fn end(self) -> Result<(), Error> {
        self.w.out.push_str(self.close);
        Ok(())
    }
}

impl ser::SerializeTuple for Compound<'_> {
    type Ok = ();
    type Error = Error;
    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        ser::SerializeSeq::serialize_element(self, value)
    }
    fn end(self) -> Result<(), Error> {
        ser::SerializeSeq::end(self)
    }
}

impl ser::SerializeTupleStruct for Compound<'_> {
    type Ok = ();
    type Error = Error;
    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        ser::SerializeSeq::serialize_element(self, value)
    }
    fn end(self) -> Result<(), Error> {
        ser::SerializeSeq::end(self)
    }
}

impl ser::SerializeTupleVariant for Compound<'_> {
    type Ok = ();
    type Error = Error;
    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        ser::SerializeSeq::serialize_element(self, value)
    }
    fn end(self) -> Result<(), Error> {
        ser::SerializeSeq::end(self)
    }
}

impl ser::SerializeMap for Compound<'_> {
    type Ok = ();
    type Error = Error;
    fn serialize_key<T: Serialize + ?Sized>(&mut self, key: &T) -> Result<(), Error> {
        self.comma();
        let mut k = Writer { out: String::new() };
        key.serialize(&mut k)?;
        // Integer keys are written as strings, as JSON requires.
        if k.out.starts_with('"') {
            self.w.out.push_str(&k.out);
        } else {
            write_str(&mut self.w.out, &k.out);
        }
        self.w.out.push(':');
        Ok(())
    }
    fn serialize_value<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        value.serialize(&mut *self.w)
    }
    fn end(self) -> Result<(), Error> {
        self.w.out.push_str(self.close);
        Ok(())
    }
}

impl ser::SerializeStruct for Compound<'_> {
    type Ok = ();
    type Error = Error;
    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), Error> {
        self.comma();
        write_str(&mut self.w.out, key);
        self.w.out.push(':');
        value.serialize(&mut *self.w)
    }
    fn end(self) -> Result<(), Error> {
        self.w.out.push_str(self.close);
        Ok(())
    }
}

impl ser::SerializeStructVariant for Compound<'_> {
    type Ok = ();
    type Error = Error;
    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), Error> {
        ser::SerializeStruct::serialize_field(self, key, value)
    }
    fn end(self) -> Result<(), Error> {
        self.w.out.push_str(self.close);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Serialize;
    use std::collections::BTreeMap;

    #[derive(Serialize)]
    #[serde(tag = "kind", rename_all = "lowercase")]
    enum Shape {
        Line {
            a: [f64; 2],
            b: [f64; 2],
        },
        Circle {
            r: f64,
            #[serde(skip_serializing_if = "Option::is_none")]
            note: Option<String>,
        },
    }

    #[derive(Serialize)]
    #[serde(untagged)]
    enum Outcome {
        Ok(Shape),
        Err { error: String },
    }

    #[test]
    fn numbers_keep_their_bits_and_non_finite_values() {
        let v = vec![
            0.1,
            -0.0,
            1e21,
            1.5e-7,
            4426815.485128365,
            f64::NAN,
            f64::INFINITY,
            f64::NEG_INFINITY,
            3.0,
        ];
        let s = to_string(&v).unwrap();
        assert_eq!(
            s,
            r##"[0.1,-0,1e21,1.5e-7,4426815.485128365,"#NaN","#Inf","#-Inf",3]"##
        );
        // Every finite number reads back exactly.
        let back: Vec<serde_json::Value> = serde_json::from_str(&s).unwrap();
        for (x, b) in v.iter().zip(&back) {
            if x.is_finite() && *x != 0.0 {
                assert_eq!(b.as_f64().unwrap().to_bits(), x.to_bits());
            }
        }
        for x in [
            f64::MIN_POSITIVE,
            5e-324,
            f64::MAX,
            123456789.12345678,
            1e-6,
            9.999999999999999e20,
        ] {
            let t = to_string(&x).unwrap();
            assert_eq!(t.parse::<f64>().unwrap().to_bits(), x.to_bits(), "{t}");
        }
    }

    #[test]
    fn serde_shapes_match_serde_json() {
        let shapes = vec![
            // Whole numbers aside (serde_json writes 1.0, JavaScript and this writer 1).
            Outcome::Ok(Shape::Line {
                a: [0.5, 1.5],
                b: [2.5, -3.25],
            }),
            Outcome::Ok(Shape::Circle { r: 2.5, note: None }),
            Outcome::Ok(Shape::Circle {
                r: 0.125,
                note: Some("a\"b\\c\n\u{1}".into()),
            }),
            Outcome::Err {
                error: "Yarıçap çok büyük.".into(),
            },
        ];
        assert_eq!(
            to_string(&shapes).unwrap(),
            serde_json::to_string(&shapes).unwrap()
        );
        let mut m = BTreeMap::new();
        m.insert(3u32, Some(vec![(1u8, true)]));
        m.insert(7u32, None);
        assert_eq!(to_string(&m).unwrap(), serde_json::to_string(&m).unwrap());
        assert_eq!(to_string(&()).unwrap(), "null");
    }
}
