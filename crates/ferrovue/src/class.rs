use crate::{escape_into, js_trim, record};

/// `escapeHtml(normalizeClass([...]))` for a list of strings: each one trimmed, the empty ones
/// dropped, the rest joined with one space. `after` says a class has already been written, so the
/// first item written here needs a separator too.
///
/// # Example
///
/// ```
/// let mut out = String::from("card");
/// ferrovue::class_into(&mut out, true, &[" big ", "", "x<y"]);
/// assert_eq!(out, "card big x&lt;y");
/// ```
pub fn class_into(out: &mut String, after: bool, items: &[&str]) {
    let mut sep = after;
    for item in items {
        let item = js_trim(item);
        if item.is_empty() {
            continue;
        }
        if sep {
            out.push(' ');
        }
        escape_into(out, item);
        sep = true;
    }
}

/// `normalizeClass` of an object: the names whose condition holds, each followed by a space, the
/// whole trimmed once — so a name's own surrounding spaces survive between its neighbours, as in
/// Vue. Generated code uses it for an object with computed names, which may hold any text.
///
/// # Example
///
/// ```
/// // `{ active: true, [" wide "]: true, hidden: false }`
/// assert_eq!(ferrovue::class_object(&[(true, "active"), (true, " wide "), (false, "hidden")]), "active  wide");
/// ```
pub fn class_object(entries: &[(bool, &str)]) -> String {
    let mut names: Vec<(&str, bool)> = Vec::new();
    for (on, name) in entries {
        match names.iter_mut().find(|(n, _)| n == name) {
            Some(entry) => entry.1 = *on,
            None => names.push((name, *on)),
        }
    }
    let mut ordered: Vec<(Option<u32>, &str, bool)> = names
        .into_iter()
        .map(|(n, on)| (record::array_index(n), n, on))
        .collect();
    ordered.sort_by_key(|(i, _, _)| i.map_or((1, 0), |i| (0, i)));
    let mut s = String::new();
    for (_, name, on) in ordered {
        if on {
            s.push_str(name);
            s.push(' ');
        }
    }
    js_trim(&s).to_owned()
}

#[cfg(test)]
mod tests;
