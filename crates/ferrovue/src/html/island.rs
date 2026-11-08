use super::Hydrate;
use crate::{json, render::Refused};
use ferrovue_core::escape_into;
use serde::Serialize;

pub(super) fn island_into<P: Serialize>(
    out: &mut String,
    name: &str,
    hydrate: Option<&Hydrate>,
    dates: &str,
    props: &P,
    render: impl FnOnce(&mut String) -> Result<(), Refused>,
) -> Result<(), Refused> {
    out.push_str("<div data-island=\"");
    escape_into(out, name);
    out.push_str("\" data-props='");
    json::escaped_into(out, props);
    out.push('\'');
    if let Some(hydrate) = hydrate {
        out.push_str(" data-hydrate=\"");
        escape_into(out, &hydrate.attribute());
        out.push('"');
    }
    if !dates.is_empty() {
        out.push_str(" data-dates=\"");
        escape_into(out, dates);
        out.push('"');
    }
    out.push('>');
    render(out)?;
    out.push_str("</div>");
    Ok(())
}
