use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

struct Fixtures(PathBuf);

impl Fixtures {
    fn new(files: &[(&str, &str)]) -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "ferrovue-fixtures-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        for (path, text) in files {
            let path = dir.join(path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        }
        fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
}

impl Drop for Fixtures {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn render_json(component: &str, json: &str) -> Result<String, String> {
    let props: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    match component {
        "Hello" => Ok(format!("<p>Hello, {}</p>", props["name"].as_str().unwrap())),
        other => Err(format!("no component called {other}")),
    }
}

const ADA: [(&str, &str); 2] = [
    ("Hello/ada.json", r#"{"name":"Ada"}"#),
    ("Hello/ada.html", "<p>Hello, Ada</p>"),
];

#[test]
fn counts_the_fixtures_that_render_as_recorded() {
    let fixtures = Fixtures::new(&[
        ADA[0],
        ADA[1],
        ("Hello/grace.json", r#"{"name":"Grace"}"#),
        ("Hello/grace.html", "<p>Hello, Grace</p>"),
        ("Hello/notes.txt", "not a fixture"),
    ]);
    assert_eq!(check_fixtures(&fixtures.0, 2, render_json), 2);
}

#[test]
fn reports_where_a_render_differs_from_the_recorded_html() {
    let fixtures = Fixtures::new(&[
        ADA[0],
        ("Hello/ada.html", "<p>Hello, Ada</p>\n"),
        ("Hello/zed.json", r#"{"name":"Zé"}"#),
        ("Hello/zed.html", "<p>\nHello, Zè</p>"),
    ]);
    let report = compare(&fixtures.0, 1, &render_json).unwrap_err();
    assert_eq!(
        report,
        format!(
            "the fixtures under {} do not all render as Vue rendered them:\n\n\
             Hello/ada.json: the Rust render differs from the recorded HTML, first difference at byte 17 (line 1, column 18):\n  \
             recorded: \"<p>Hello, Ada</p>\\n\"\n  \
             rendered: \"<p>Hello, Ada</p>\"\n\n\
             Hello/zed.json: the Rust render differs from the recorded HTML, first difference at byte 3 (line 1, column 4):\n  \
             recorded: \"<p>\\nHello, Zè</p>\"\n  \
             rendered: \"<p>Hello, Zé</p>\"",
            fixtures.0.display()
        )
    );
}

#[test]
fn reports_a_difference_inside_a_character_from_where_it_starts() {
    assert_eq!(
        first_difference("<p>é</p>", "<p>è</p>"),
        "first difference at byte 3 (line 1, column 4):\n  recorded: \"<p>é</p>\"\n  rendered: \"<p>è</p>\""
    );
    let long = "x".repeat(100);
    assert_eq!(
        first_difference(&format!("{long}\n{long}a"), &format!("{long}\n{long}b")),
        format!(
            "first difference at byte 201 (line 2, column 101):\n  recorded: {:?}\n  rendered: {:?}",
            format!("{}a", "x".repeat(40)),
            format!("{}b", "x".repeat(40)),
        )
    );
}

#[test]
fn reports_a_fixture_without_recorded_html_or_without_a_component() {
    let fixtures = Fixtures::new(&[
        ("Hello/ada.json", r#"{"name":"Ada"}"#),
        ("Ghost/one.json", "{}"),
        ("Ghost/one.html", ""),
    ]);
    let report = compare(&fixtures.0, 1, &render_json).unwrap_err();
    assert!(
        report.ends_with(
            "\n\nGhost/one.json: no component called Ghost\n\n\
             Hello/ada.json: no recorded HTML: record it from Vue with FERROVUE_FIXTURES_WRITE=1"
        ),
        "{report}"
    );
}

#[test]
fn fails_when_fewer_fixtures_are_found_than_expected() {
    let fixtures = Fixtures::new(&ADA);
    let report = compare(&fixtures.0, 2, &render_json).unwrap_err();
    assert!(
        report.ends_with(&format!(
            "found 1 fixtures under {}, and expected at least 2",
            fixtures.0.display()
        )),
        "{report}"
    );
    let empty = Fixtures::new(&[]);
    assert!(compare(&empty.0, 1, &render_json).is_err());
    assert_eq!(compare(&empty.0, 0, &render_json), Ok(0));
}

#[test]
fn fails_when_the_fixtures_cannot_be_read() {
    let missing = std::env::temp_dir().join("ferrovue-no-such-fixtures");
    let report = compare(&missing, 1, &render_json).unwrap_err();
    assert!(
        report.starts_with(&format!("cannot read {}: ", missing.display())),
        "{report}"
    );
}

#[test]
#[should_panic(expected = "Hello/ada.json: the Rust render differs from the recorded HTML")]
fn check_fixtures_panics_with_the_report() {
    let fixtures = Fixtures::new(&[ADA[0], ("Hello/ada.html", "<p>Hi, Ada</p>")]);
    check_fixtures(&fixtures.0, 1, render_json);
}
