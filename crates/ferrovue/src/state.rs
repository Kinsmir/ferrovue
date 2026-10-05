//! The stores' state, written into the page for the client to read back before it hydrates.

use serde::Serialize;

use crate::{escape_into, json};

/// The stores' state as the client reads it back before it hydrates: a `<script type="application/json">`,
/// which a `script-src 'self'` policy does not run, so the page needs no nonce for it. `<`, `>`, `&`
/// and the two line separators are written as JSON escapes, so no value can end the element or be
/// read as markup inside it.
///
/// `id` is the element's `id`, which the client looks the state up by: `"__pinia"` is what
/// `hydrateState` from `ferrovue/client` reads by default. `state` is usually the generated
/// `stores::Stores`; see [`guide::pinia`](crate::guide::pinia).
///
/// # Example
///
/// ```
/// let state = serde_json::json!({ "prefs": { "theme": "</script>" } });
/// let mut page = String::new();
/// ferrovue::state_script_into(&mut page, "__pinia", &state);
/// assert_eq!(
///     page,
///     r#"<script type="application/json" id="__pinia">{"prefs":{"theme":"\u003c/script\u003e"}}</script>"#
/// );
/// ```
pub fn state_script_into(out: &mut String, id: &str, state: &impl Serialize) {
    out.push_str("<script type=\"application/json\" id=\"");
    escape_into(out, id);
    out.push_str("\">");
    // As in `island_into`: a struct of strings, numbers and lists cannot fail to serialise, and if it
    // somehow did the client would find no state and render from its own. `NaN` and the infinities
    // are written as JavaScript writes them, which `hydrateState` reads back.
    let json = json::to_string(state);
    json_escaped_into(out, &json);
    out.push_str("</script>");
}

/// JSON with `<`, `>`, `&`, U+2028 and U+2029 written as escapes. The runs between them are copied
/// whole: every byte matched is the first of its character, so each cut is at a char boundary.
pub(crate) fn json_escaped_into(out: &mut String, json: &str) {
    out.reserve(json.len());
    let bytes = json.as_bytes();
    let (mut last, mut i) = (0, 0);
    while i < bytes.len() {
        let (rep, width) = match bytes[i] {
            b'<' => ("\\u003c", 1),
            b'>' => ("\\u003e", 1),
            b'&' => ("\\u0026", 1),
            // U+2028 and U+2029 are E2 80 A8 and E2 80 A9.
            0xE2 if bytes.get(i + 1) == Some(&0x80) && bytes.get(i + 2) == Some(&0xA8) => {
                ("\\u2028", 3)
            }
            0xE2 if bytes.get(i + 1) == Some(&0x80) && bytes.get(i + 2) == Some(&0xA9) => {
                ("\\u2029", 3)
            }
            _ => {
                i += 1;
                continue;
            }
        };
        out.push_str(&json[last..i]);
        out.push_str(rep);
        i += width;
        last = i;
    }
    out.push_str(&json[last..]);
}

#[cfg(test)]
mod tests;
