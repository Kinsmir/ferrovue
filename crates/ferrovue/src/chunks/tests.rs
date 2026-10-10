use super::*;

const MANIFEST: &str = r#"{
    "client/main.ts": { "file": "assets/main.js", "isEntry": true, "css": ["assets/main.css"], "dynamicImports": ["client/app.ts"] },
    "client/app.ts": { "file": "assets/app.js", "isDynamicEntry": true, "imports": ["_vue.js"], "dynamicImports": ["client/components/Cart.vue", "client/components/Reviews.vue"] },
    "client/components/Cart.vue": { "file": "assets/Cart.js", "isDynamicEntry": true, "imports": ["_vue.js", "_money.js", "client/main.ts"] },
    "client/components/Reviews.vue": { "file": "assets/Reviews.js", "isDynamicEntry": true, "imports": ["_vue.js"], "dynamicImports": ["client/components/Stars.vue"] },
    "client/components/Stars.vue": { "file": "assets/Stars.js", "isDynamicEntry": true },
    "_money.js": { "file": "assets/money.js", "imports": ["_vue.js"] },
    "_vue.js": { "file": "assets/vue.js" }
}"#;

const ISLANDS: &str = r#"{
    "Cart": "assets/Cart.js",
    "Reviews": "assets/Reviews.js",
    "Unbuilt": "assets/Unbuilt.js"
}"#;

fn chunks() -> Chunks {
    Chunks::from_manifest(MANIFEST, ISLANDS).unwrap()
}

#[test]
fn an_island_needs_its_chunk_and_what_it_imports_but_never_the_entry() {
    assert_eq!(
        chunks().for_islands(["Cart"]),
        ["/assets/Cart.js", "/assets/vue.js", "/assets/money.js"]
    );
}

#[test]
fn dynamic_imports_are_left_to_load_when_asked_for() {
    assert_eq!(
        chunks().for_islands(["Reviews"]),
        ["/assets/Reviews.js", "/assets/vue.js"]
    );
}

#[test]
fn islands_sharing_a_chunk_need_it_once() {
    assert_eq!(
        chunks().for_islands(["Reviews", "Cart", "Reviews"]),
        [
            "/assets/Reviews.js",
            "/assets/vue.js",
            "/assets/Cart.js",
            "/assets/money.js"
        ]
    );
}

#[test]
fn names_that_are_no_built_island_need_nothing() {
    assert!(chunks().for_islands(["Unbuilt", "Nowhere"]).is_empty());
}

#[test]
fn the_app_the_entry_loads_dynamically() {
    assert_eq!(
        chunks().for_source("client/app.ts"),
        ["/assets/app.js", "/assets/vue.js"]
    );
    assert!(chunks().for_source("client/main.ts").is_empty());
    assert!(chunks().for_source("client/missing.ts").is_empty());
}

#[test]
fn the_files_are_served_under_the_base() {
    assert_eq!(
        chunks().with_base("/static/").for_islands(["Reviews"]),
        ["/static/assets/Reviews.js", "/static/assets/vue.js"]
    );
}

#[test]
fn a_page_links_each_url_once_across_head_and_body() {
    let chunks = chunks().with_base("/a&b/");
    let mut preloads = chunks.preloads();
    let mut head = String::new();
    preloads.source_into(&mut head, "client/app.ts");
    preloads.islands_into(&mut head, ["Reviews"]);
    let mut body = String::new();
    preloads.islands_into(&mut body, ["Cart", "Reviews"]);
    assert_eq!(
        head,
        concat!(
            r#"<link rel="modulepreload" href="/a&amp;b/assets/app.js">"#,
            r#"<link rel="modulepreload" href="/a&amp;b/assets/vue.js">"#,
            r#"<link rel="modulepreload" href="/a&amp;b/assets/Reviews.js">"#,
        )
    );
    assert_eq!(
        body,
        concat!(
            r#"<link rel="modulepreload" href="/a&amp;b/assets/Cart.js">"#,
            r#"<link rel="modulepreload" href="/a&amp;b/assets/money.js">"#,
        )
    );
}

#[test]
fn an_island_bundled_into_a_shared_chunk_is_found_by_its_file() {
    let manifest = r#"{
        "client/main.ts": { "file": "assets/main.js", "isEntry": true, "dynamicImports": ["_Badge-1.js", "client/components/Card.vue"] },
        "client/components/Card.vue": { "file": "assets/Card-2.js", "isDynamicEntry": true, "imports": ["_Badge-1.js"] },
        "_Badge-1.js": { "file": "assets/Badge-1.js", "name": "Badge", "imports": ["client/main.ts"] }
    }"#;
    let islands = r#"{ "Badge": "assets/Badge-1.js", "Card": "assets/Card-2.js" }"#;
    let chunks = Chunks::from_manifest(manifest, islands).unwrap();
    assert_eq!(chunks.for_islands(["Badge"]), ["/assets/Badge-1.js"]);
    assert_eq!(
        chunks.for_islands(["Card", "Badge"]),
        ["/assets/Card-2.js", "/assets/Badge-1.js"]
    );
}

#[test]
fn what_is_not_a_manifest_is_refused() {
    let error = Chunks::from_manifest(r#"{"a.js": {"imports": []}}"#, ISLANDS).unwrap_err();
    assert!(
        error
            .to_string()
            .starts_with("not a Vite manifest: missing field `file`"),
        "{error}"
    );
    assert!(Chunks::from_manifest("[", ISLANDS).is_err());
    let error = Chunks::from_manifest(MANIFEST, r#"{"Cart": 1}"#).unwrap_err();
    assert!(
        error.to_string().starts_with("not ferrovue's islands: "),
        "{error}"
    );
}
