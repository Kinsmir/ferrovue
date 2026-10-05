//! The Rust half of the example's fixtures: each `fixtures/<Component>/<case>.json`, rendered by the
//! generated code, is the `.html` beside it, which `test/fixtures.test.ts` recorded from Vue.

use std::fs;
use std::path::Path;

#[test]
fn every_fixture_renders_as_vue_rendered_it() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures");
    let mut checked = 0;
    for component in fs::read_dir(&root).expect("fixtures") {
        let component = component.expect("fixture directory").path();
        let name = component
            .file_name()
            .and_then(|n| n.to_str())
            .expect("a component's name")
            .to_owned();
        for file in fs::read_dir(&component).expect("fixture files") {
            let json = file.expect("fixture").path();
            if json.extension().is_none_or(|e| e != "json") {
                continue;
            }
            let want = fs::read_to_string(json.with_extension("html")).expect("recorded HTML");
            let got =
                crate::generated::render_json(&name, &fs::read_to_string(&json).expect("fixture"))
                    .unwrap_or_else(|e| panic!("{}: {e}", json.display()));
            assert_eq!(got, want, "{}", json.display());
            checked += 1;
        }
    }
    assert!(checked > 0, "no fixtures were found");
}
