use ferrovue::{Attr, Attrs};

use crate::generated::twins::{StarRatingProps, StarRatingSlots};

pub fn star_rating(out: &mut String, props: &StarRatingProps<'_>, slots: StarRatingSlots<'_>, attrs: &Attrs<'_>) {
    let max = props.max.unwrap_or(5);
    let described;
    let label = match props.label {
        Some(label) => label,
        None => {
            described = format!("{} of {max}", props.value);
            &described
        }
    };
    let own = [
        ("class", Attr::str("stars")),
        ("role", Attr::str("img")),
        ("aria-label", Attr::str(label)),
        ("data-readonly", if props.readonly { Attr::str("") } else { Attr::Undefined }),
    ];
    out.push_str("<div");
    ferrovue::attrs_into(out, &[&own, attrs.list()], 1, attrs.ids());
    out.push('>');
    for i in 0..max {
        out.push_str(if i < props.value { r#"<span class="on">★</span>"# } else { r#"<span class="off">★</span>"# });
    }
    match slots.default {
        Some(slot) => {
            out.push_str("<!--[-->");
            slot.render_to(out);
            out.push_str("<!--]-->");
        }
        None => out.push_str("<!---->"),
    }
    out.push_str("</div>");
}
