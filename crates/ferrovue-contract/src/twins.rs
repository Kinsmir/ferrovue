//! The Rust twins `ferrovue.config.json` names.

use ferrovue::Attrs;

use crate::generated::twins::{StarRatingProps, StarRatingSlots};

/// `<StarRating>`, as `vendor/StarRating.ts` renders it.
pub fn star_rating(
    out: &mut String,
    props: &StarRatingProps,
    slots: StarRatingSlots<'_>,
    attrs: &Attrs<'_>,
) {
    out.push_str("<span");
    ferrovue::attrs_into(
        out,
        &[&[("class", ferrovue::Attr::str("stars"))], attrs.list()],
        1,
        attrs.ids(),
    );
    out.push('>');
    ferrovue::push_int(out, props.value);
    out.push('/');
    ferrovue::push_int(out, props.max.unwrap_or(5));
    match slots.default {
        Some(slot) => {
            out.push_str("<!--[-->");
            slot.render_to(out);
            out.push_str("<!--]-->");
        }
        None => out.push_str("<!---->"),
    }
    out.push_str("</span>");
}
