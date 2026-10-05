use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

/// Render every fixture under `fixtures` with `render_json` and compare the bytes with the HTML Vue
/// recorded beside it: the Rust half of an application's conformance suite, of which
/// `conformanceSuite` in `ferrovue/testing` is the Vue half.
///
/// `fixtures` holds a directory per component, named as the component is, of `<case>.json` (the
/// props, with `$slots`, `$route`, `$stores` and `$locale` as the component takes them) and
/// `<case>.html`. `render_json` is the generated `render_json`, which exists in test builds only.
/// Returns how many fixtures were checked, and panics, listing each one, when a fixture renders
/// differently, has no recorded HTML or names no component, or when fewer than `at_least` were
/// found. [`conformance!`](crate::conformance!) writes the test that calls it.
///
/// # Panics
///
/// When any fixture fails, `fixtures` cannot be read, or fewer than `at_least` fixtures are found.
pub fn check_fixtures<F>(fixtures: impl AsRef<Path>, at_least: usize, render_json: F) -> usize
where
    F: Fn(&str, &str) -> Result<String, String>,
{
    compare(fixtures.as_ref(), at_least, &render_json).unwrap_or_else(|report| panic!("{report}"))
}

fn sorted_entries(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
    let mut paths = entries
        .map(|entry| entry.map(|e| e.path()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
    paths.sort();
    Ok(paths)
}

fn file_name(path: &Path) -> &str {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
}

fn compare(
    fixtures: &Path,
    at_least: usize,
    render_json: &dyn Fn(&str, &str) -> Result<String, String>,
) -> Result<usize, String> {
    let mut found = 0;
    let mut problems = Vec::new();
    for component in sorted_entries(fixtures)?.into_iter().filter(|p| p.is_dir()) {
        let name = file_name(&component);
        for json in sorted_entries(&component)?
            .into_iter()
            .filter(|p| p.extension().is_some_and(|e| e == "json"))
        {
            found += 1;
            let case = format!("{name}/{}", file_name(&json));
            if let Some(problem) = check_one(&case, name, &json, render_json) {
                problems.push(problem);
            }
        }
    }
    if found < at_least {
        problems.push(format!(
            "found {found} fixtures under {}, and expected at least {at_least}",
            fixtures.display()
        ));
    }
    if problems.is_empty() {
        return Ok(found);
    }
    Err(format!(
        "the fixtures under {} do not all render as Vue rendered them:\n\n{}",
        fixtures.display(),
        problems.join("\n\n")
    ))
}

fn check_one(
    case: &str,
    component: &str,
    json: &Path,
    render_json: &dyn Fn(&str, &str) -> Result<String, String>,
) -> Option<String> {
    let props = match fs::read_to_string(json) {
        Ok(props) => props,
        Err(e) => return Some(format!("{case}: cannot read it: {e}")),
    };
    let Ok(recorded) = fs::read_to_string(json.with_extension("html")) else {
        return Some(format!(
            "{case}: no recorded HTML: record it from Vue with FERROVUE_FIXTURES_WRITE=1"
        ));
    };
    match render_json(component, &props) {
        Err(e) => Some(format!("{case}: {e}")),
        Ok(rendered) if rendered == recorded => None,
        Ok(rendered) => Some(format!(
            "{case}: the Rust render differs from the recorded HTML, {}",
            first_difference(&recorded, &rendered)
        )),
    }
}

fn floor_boundary(s: &str, mut at: usize) -> usize {
    at = at.min(s.len());
    while !s.is_char_boundary(at) {
        at -= 1;
    }
    at
}

fn around(s: &str, at: usize) -> &str {
    let start = floor_boundary(s, at.saturating_sub(40));
    let end = floor_boundary(s, at.saturating_add(40));
    &s[start..end]
}

fn first_difference(recorded: &str, rendered: &str) -> String {
    let same = recorded
        .bytes()
        .zip(rendered.bytes())
        .take_while(|(a, b)| a == b)
        .count();
    let at = floor_boundary(recorded, same);
    let before = &recorded[..at];
    let line = before.matches('\n').count() + 1;
    let column = before
        .rsplit('\n')
        .next()
        .unwrap_or_default()
        .chars()
        .count()
        + 1;
    let mut out = format!("first difference at byte {at} (line {line}, column {column}):");
    let _ = write!(out, "\n  recorded: {:?}", around(recorded, at));
    let _ = write!(out, "\n  rendered: {:?}", around(rendered, at));
    out
}

/// Write the test that renders every fixture through the generated `render_json` and compares
/// the bytes with the HTML Vue recorded: [`check_fixtures`](crate::check_fixtures) over a
/// directory relative to the crate's manifest, failing when fewer than `at_least` fixtures (one
/// when not given) are found.
///
/// ```
/// mod generated {
///     pub fn render_json(component: &str, json: &str) -> Result<String, String> {
///         Err(format!("no component called {component}"))
///     }
/// }
///
/// ferrovue::conformance!("fixtures", generated::render_json);
/// # fn main() {}
/// ```
///
/// With a floor on the fixtures found:
///
/// ```
/// # mod generated {
/// #     pub fn render_json(_: &str, _: &str) -> Result<String, String> { Ok(String::new()) }
/// # }
/// ferrovue::conformance!("fixtures", generated::render_json, at_least = 20);
/// # fn main() {}
/// ```
#[macro_export]
macro_rules! conformance {
    ($fixtures:expr, $render_json:path $(,)?) => {
        $crate::conformance!($fixtures, $render_json, at_least = 1);
    };
    ($fixtures:expr, $render_json:path, at_least = $at_least:expr $(,)?) => {
        #[test]
        fn every_fixture_renders_as_vue_rendered_it() {
            $crate::check_fixtures(
                ::std::path::Path::new(::std::env!("CARGO_MANIFEST_DIR")).join($fixtures),
                $at_least,
                $render_json,
            );
        }
    };
}

#[cfg(test)]
mod tests;
