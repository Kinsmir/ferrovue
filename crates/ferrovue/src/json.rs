//! JSON for the browser to read back: an island's props and the stores' state.
//!
//! `serde_json` writes `NaN` and the infinities as `null`, which the client would read back as a
//! different value from the one the server rendered with: the server writes `NaN`, the client
//! renders an empty string, and the page hydrates with a mismatch. Here they are written as
//! JavaScript spells them, the bare tokens `NaN`, `Infinity` and `-Infinity`, which `JSON.parse`
//! refuses and `ferrovue/client` reads back exactly (`parseJson` in `client.ts`). Everything else is
//! `serde_json`'s output, byte for byte.
//!
//! `serde_json` decides a float is not finite before its [`Formatter`] sees it, and hands the
//! formatter a `null` either way. So the serializer is wrapped: the wrapper notes the token a
//! non-finite float stands for, and the formatter writes it in place of the `null` that follows.

use std::cell::Cell;
use std::io;

use serde::Serialize;
use serde::ser::{self, Serializer};
use serde_json::ser::Formatter;

/// The token a non-finite float is to be written as, set just before `serde_json` asks the
/// formatter for the `null` it writes for one.
type Pending = Cell<Option<&'static str>>;

/// `value` as JSON, with non-finite floats as JavaScript writes them. Empty if it fails to
/// serialise, which a struct of strings, numbers and lists cannot.
pub(crate) fn to_string<T: Serialize + ?Sized>(value: &T) -> String {
    let pending = Pending::new(None);
    let mut out = Vec::with_capacity(128);
    let mut json = serde_json::Serializer::with_formatter(&mut out, Tokens(&pending));
    if value.serialize(Wrap(&mut json, &pending)).is_err() {
        return String::new();
    }
    // `serde_json` writes UTF-8, and the tokens are ASCII.
    String::from_utf8(out).unwrap_or_default()
}

/// `serde_json`'s compact formatter, writing the pending token in place of a float's `null`.
struct Tokens<'c>(&'c Pending);

impl Formatter for Tokens<'_> {
    fn write_null<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        writer.write_all(self.0.take().unwrap_or("null").as_bytes())
    }
}

/// What a non-finite float is written as: `String(x)` in JavaScript.
fn token(x: f64) -> Option<&'static str> {
    if x.is_nan() {
        Some("NaN")
    } else if x == f64::INFINITY {
        Some("Infinity")
    } else if x == f64::NEG_INFINITY {
        Some("-Infinity")
    } else {
        None
    }
}

/// A serializer, or one of its compound parts, that hands every value inside it the same wrapping.
struct Wrap<'c, S>(S, &'c Pending);

/// A value to be serialised through [`Wrap`].
struct Value<'v, 'c, T: ?Sized>(&'v T, &'c Pending);

impl<T: Serialize + ?Sized> Serialize for Value<'_, '_, T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(Wrap(serializer, self.1))
    }
}

/// Methods that hand the value on unchanged.
macro_rules! forward {
    ($($method:ident($($arg:ident: $ty:ty),*);)*) => {
        $(fn $method(self, $($arg: $ty),*) -> Result<S::Ok, S::Error> {
            self.0.$method($($arg),*)
        })*
    };
}

impl<'c, S: Serializer> Serializer for Wrap<'c, S> {
    type Ok = S::Ok;
    type Error = S::Error;
    type SerializeSeq = Wrap<'c, S::SerializeSeq>;
    type SerializeTuple = Wrap<'c, S::SerializeTuple>;
    type SerializeTupleStruct = Wrap<'c, S::SerializeTupleStruct>;
    type SerializeTupleVariant = Wrap<'c, S::SerializeTupleVariant>;
    type SerializeMap = Wrap<'c, S::SerializeMap>;
    type SerializeStruct = Wrap<'c, S::SerializeStruct>;
    type SerializeStructVariant = Wrap<'c, S::SerializeStructVariant>;

    forward! {
        serialize_bool(v: bool);
        serialize_i8(v: i8);
        serialize_i16(v: i16);
        serialize_i32(v: i32);
        serialize_i64(v: i64);
        serialize_i128(v: i128);
        serialize_u8(v: u8);
        serialize_u16(v: u16);
        serialize_u32(v: u32);
        serialize_u64(v: u64);
        serialize_u128(v: u128);
        serialize_char(v: char);
        serialize_str(v: &str);
        serialize_bytes(v: &[u8]);
        serialize_none();
        serialize_unit();
        serialize_unit_struct(name: &'static str);
        serialize_unit_variant(name: &'static str, index: u32, variant: &'static str);
    }

    // `serde_json` asks for a `null` for exactly the floats that have a token, and the formatter
    // takes the token as it writes it, so nothing is left pending for the next `null`.
    fn serialize_f32(self, v: f32) -> Result<S::Ok, S::Error> {
        self.1.set(token(v.into()));
        self.0.serialize_f32(v)
    }

    fn serialize_f64(self, v: f64) -> Result<S::Ok, S::Error> {
        self.1.set(token(v));
        self.0.serialize_f64(v)
    }

    fn serialize_some<T: Serialize + ?Sized>(self, value: &T) -> Result<S::Ok, S::Error> {
        self.0.serialize_some(&Value(value, self.1))
    }

    fn serialize_newtype_struct<T: Serialize + ?Sized>(
        self,
        name: &'static str,
        value: &T,
    ) -> Result<S::Ok, S::Error> {
        self.0.serialize_newtype_struct(name, &Value(value, self.1))
    }

    fn serialize_newtype_variant<T: Serialize + ?Sized>(
        self,
        name: &'static str,
        index: u32,
        variant: &'static str,
        value: &T,
    ) -> Result<S::Ok, S::Error> {
        self.0
            .serialize_newtype_variant(name, index, variant, &Value(value, self.1))
    }

    fn serialize_seq(self, len: Option<usize>) -> Result<Self::SerializeSeq, S::Error> {
        Ok(Wrap(self.0.serialize_seq(len)?, self.1))
    }

    fn serialize_tuple(self, len: usize) -> Result<Self::SerializeTuple, S::Error> {
        Ok(Wrap(self.0.serialize_tuple(len)?, self.1))
    }

    fn serialize_tuple_struct(
        self,
        name: &'static str,
        len: usize,
    ) -> Result<Self::SerializeTupleStruct, S::Error> {
        Ok(Wrap(self.0.serialize_tuple_struct(name, len)?, self.1))
    }

    fn serialize_tuple_variant(
        self,
        name: &'static str,
        index: u32,
        variant: &'static str,
        len: usize,
    ) -> Result<Self::SerializeTupleVariant, S::Error> {
        Ok(Wrap(
            self.0.serialize_tuple_variant(name, index, variant, len)?,
            self.1,
        ))
    }

    fn serialize_map(self, len: Option<usize>) -> Result<Self::SerializeMap, S::Error> {
        Ok(Wrap(self.0.serialize_map(len)?, self.1))
    }

    fn serialize_struct(
        self,
        name: &'static str,
        len: usize,
    ) -> Result<Self::SerializeStruct, S::Error> {
        Ok(Wrap(self.0.serialize_struct(name, len)?, self.1))
    }

    fn serialize_struct_variant(
        self,
        name: &'static str,
        index: u32,
        variant: &'static str,
        len: usize,
    ) -> Result<Self::SerializeStructVariant, S::Error> {
        Ok(Wrap(
            self.0.serialize_struct_variant(name, index, variant, len)?,
            self.1,
        ))
    }
}

impl<S: ser::SerializeSeq> ser::SerializeSeq for Wrap<'_, S> {
    type Ok = S::Ok;
    type Error = S::Error;

    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), S::Error> {
        self.0.serialize_element(&Value(value, self.1))
    }

    fn end(self) -> Result<S::Ok, S::Error> {
        self.0.end()
    }
}

impl<S: ser::SerializeTuple> ser::SerializeTuple for Wrap<'_, S> {
    type Ok = S::Ok;
    type Error = S::Error;

    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), S::Error> {
        self.0.serialize_element(&Value(value, self.1))
    }

    fn end(self) -> Result<S::Ok, S::Error> {
        self.0.end()
    }
}

impl<S: ser::SerializeTupleStruct> ser::SerializeTupleStruct for Wrap<'_, S> {
    type Ok = S::Ok;
    type Error = S::Error;

    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), S::Error> {
        self.0.serialize_field(&Value(value, self.1))
    }

    fn end(self) -> Result<S::Ok, S::Error> {
        self.0.end()
    }
}

impl<S: ser::SerializeTupleVariant> ser::SerializeTupleVariant for Wrap<'_, S> {
    type Ok = S::Ok;
    type Error = S::Error;

    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), S::Error> {
        self.0.serialize_field(&Value(value, self.1))
    }

    fn end(self) -> Result<S::Ok, S::Error> {
        self.0.end()
    }
}

/// A map's keys are handed on unwrapped: JSON's keys are strings, and `serde_json` refuses a
/// non-finite float key whatever it is wrapped in.
impl<S: ser::SerializeMap> ser::SerializeMap for Wrap<'_, S> {
    type Ok = S::Ok;
    type Error = S::Error;

    fn serialize_key<T: Serialize + ?Sized>(&mut self, key: &T) -> Result<(), S::Error> {
        self.0.serialize_key(key)
    }

    fn serialize_value<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), S::Error> {
        self.0.serialize_value(&Value(value, self.1))
    }

    fn end(self) -> Result<S::Ok, S::Error> {
        self.0.end()
    }
}

impl<S: ser::SerializeStruct> ser::SerializeStruct for Wrap<'_, S> {
    type Ok = S::Ok;
    type Error = S::Error;

    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), S::Error> {
        self.0.serialize_field(key, &Value(value, self.1))
    }

    fn end(self) -> Result<S::Ok, S::Error> {
        self.0.end()
    }
}

impl<S: ser::SerializeStructVariant> ser::SerializeStructVariant for Wrap<'_, S> {
    type Ok = S::Ok;
    type Error = S::Error;

    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), S::Error> {
        self.0.serialize_field(key, &Value(value, self.1))
    }

    fn end(self) -> Result<S::Ok, S::Error> {
        self.0.end()
    }
}

#[cfg(test)]
mod tests {
    use super::to_string;
    use serde::Serialize;
    use std::collections::BTreeMap;

    #[derive(Serialize)]
    struct Inner {
        ratio: f64,
        note: Option<f32>,
    }

    #[derive(Serialize)]
    struct Props {
        price: f64,
        label: &'static str,
        missing: Option<f64>,
        given: Option<f64>,
        list: Vec<f64>,
        inner: Inner,
        by_name: BTreeMap<&'static str, f64>,
        unit: (),
        pair: (f64, i64),
    }

    #[test]
    fn non_finite_floats_are_written_as_javascript_writes_them_wherever_they_are() {
        let props = Props {
            price: f64::NAN,
            label: "NaN",
            missing: None,
            given: Some(f64::NEG_INFINITY),
            list: vec![f64::INFINITY, 1.5, -0.0, f64::NAN],
            inner: Inner {
                ratio: f64::INFINITY,
                note: Some(f32::NAN),
            },
            by_name: [("a", f64::NAN), ("b", 2.0)].into_iter().collect(),
            unit: (),
            pair: (f64::NEG_INFINITY, 3),
        };
        assert_eq!(
            to_string(&props),
            r#"{"price":NaN,"label":"NaN","missing":null,"given":-Infinity,"list":[Infinity,1.5,-0.0,NaN],"inner":{"ratio":Infinity,"note":NaN},"by_name":{"a":NaN,"b":2.0},"unit":null,"pair":[-Infinity,3]}"#
        );
    }

    #[test]
    fn anything_else_is_what_serde_json_writes() {
        let value = serde_json::json!({
            "s": "a\"b<\u{2028}\u{0}", "n": [1, -2, 1.5e300, 5e-324], "b": true, "z": null, "o": {}
        });
        assert_eq!(to_string(&value), serde_json::to_string(&value).unwrap());
        let props = Props {
            price: 0.1,
            label: "x",
            missing: None,
            given: Some(2.0),
            list: vec![],
            inner: Inner {
                ratio: 1e21,
                note: None,
            },
            by_name: BTreeMap::new(),
            unit: (),
            pair: (-0.0, -1),
        };
        assert_eq!(to_string(&props), serde_json::to_string(&props).unwrap());
    }

    #[test]
    fn a_null_after_a_non_finite_float_is_still_null() {
        assert_eq!(
            to_string(&(f64::NAN, None::<f64>, (), f64::INFINITY, None::<i64>)),
            "[NaN,null,null,Infinity,null]"
        );
    }

    #[test]
    fn a_map_key_is_handed_on_as_it_is() {
        let by_number: BTreeMap<i64, f64> = [(1, f64::NAN)].into_iter().collect();
        assert_eq!(to_string(&by_number), r#"{"1":NaN}"#);
    }

    #[derive(Serialize)]
    struct Pair(f64, f64);

    #[derive(Serialize)]
    struct Wrapped(f64);

    #[derive(Serialize)]
    enum Shape {
        Empty,
        One(f64),
        Two(f64, f64),
        Named { at: f64, n: i8 },
    }

    /// Every shape `serde` has, each holding a float it must still reach.
    #[test]
    fn every_shape_of_value_hands_the_wrapping_on() {
        let value = (
            Pair(f64::NAN, 1.0),
            Wrapped(f64::INFINITY),
            [
                Shape::Empty,
                Shape::One(f64::NAN),
                Shape::Two(f64::NEG_INFINITY, 0.5),
                Shape::Named {
                    at: f64::INFINITY,
                    n: -1,
                },
            ],
        );
        assert_eq!(
            to_string(&value),
            r#"[[NaN,1.0],Infinity,["Empty",{"One":NaN},{"Two":[-Infinity,0.5]},{"Named":{"at":Infinity,"n":-1}}]]"#
        );
        let scalars = ('c', 7_u8, -7_i128, 7_u128, std::net::Ipv4Addr::LOCALHOST);
        assert_eq!(
            to_string(&scalars),
            serde_json::to_string(&scalars).unwrap()
        );
        assert_eq!(to_string(&scalars), r#"["c",7,-7,7,"127.0.0.1"]"#);
    }

    #[test]
    fn what_serde_json_refuses_gives_nothing() {
        let by_list: BTreeMap<Vec<i64>, f64> = [(vec![1], f64::NAN)].into_iter().collect();
        assert!(serde_json::to_string(&by_list).is_err());
        assert_eq!(to_string(&by_list), "");
    }
}
