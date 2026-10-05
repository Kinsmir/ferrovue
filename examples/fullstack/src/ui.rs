//! Rust twins of the components ferrovue does not compile: each writes what Vue's server renderer
//! writes for its component, which the fixtures in `fixtures/` hold it to.

use ferrovue::{Attr, Attrs};

use crate::generated::twins::StarRatingProps;

/// `<StarRating>` from `client/vendor/StarRating.ts`.
pub fn star_rating(out: &mut String, props: &StarRatingProps, attrs: &Attrs<'_>) {
    let max = props.max.unwrap_or(5);
    let label = format!("{} out of {max}", props.value);
    let own = [
        ("class", Attr::str("rating")),
        ("role", Attr::str("img")),
        ("aria-label", Attr::str(&label)),
    ];
    out.push_str("<span");
    ferrovue::attrs_into(out, &[&own, attrs.list()], 1, attrs.ids());
    out.push('>');
    for i in 0..max {
        out.push(if i < props.value { '★' } else { '☆' });
    }
    out.push_str("</span>");
}
