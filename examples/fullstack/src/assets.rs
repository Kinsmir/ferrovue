use std::path::Path;

const ENTRY: &str = "client/main.ts";

/// Where the page loads the client from.
#[derive(Debug, Clone)]
pub enum Assets {
    /// The production build: the entry's hashed script and the chunks of the build, served from
    /// `/assets`.
    Built {
        /// The entry script's URL.
        script: String,
        /// The chunks of the build, for the page's stylesheets and the islands' preloads.
        chunks: ferrovue::page::Chunks,
    },
    /// Vite's dev server at this origin (`http://localhost:5173`), which serves the sources and
    /// hot-reloads them.
    Dev(String),
    /// No client at all: the page renders, and nothing hydrates it.
    None,
}

impl Assets {
    /// The dev server when `VITE_DEV_SERVER` names one, else the build in `dist`, else nothing.
    pub fn from_env(dist: &Path) -> Assets {
        if let Ok(origin) = std::env::var("VITE_DEV_SERVER") {
            return Assets::Dev(origin.trim_end_matches('/').to_owned());
        }
        Assets::from_manifest(dist).unwrap_or_else(|problem| {
            eprintln!(
                "no client build ({problem}); pages will not hydrate. Run `pnpm build` first."
            );
            Assets::None
        })
    }

    /// The entry's files, from the manifest of a `vite build` into `dist`.
    pub fn from_manifest(dist: &Path) -> Result<Assets, String> {
        let path = dist.join(".vite/manifest.json");
        let text =
            std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        let islands_path = dist.join(".vite/ferrovue-islands.json");
        let islands = std::fs::read_to_string(&islands_path)
            .map_err(|e| format!("{}: {e}", islands_path.display()))?;
        let chunks = ferrovue::page::Chunks::from_manifest(&text, &islands)
            .map_err(|e| format!("{}: {e}", dist.display()))?;
        let script = chunks
            .script_for_entry(ENTRY)
            .ok_or_else(|| format!("{} has no entry {ENTRY}", path.display()))?;
        Ok(Assets::Built { script, chunks })
    }

    /// The `<link>`s for the `<head>`: the entry's stylesheets and those of the chunks it loads
    /// later, each island's own among them, so the server's markup is styled before it hydrates.
    /// In development Vite injects the styles itself.
    pub fn styles_into(&self, out: &mut String) {
        if let Assets::Built { chunks, .. } = self {
            chunks.stylesheets().entry_into(out, ENTRY);
        }
    }

    /// A `<link rel="modulepreload">` for each chunk the islands called `names` load, so the
    /// browser fetches them alongside the entry. In development Vite serves the sources, one
    /// module at a time.
    pub fn preloads_into<'n>(&self, out: &mut String, names: impl IntoIterator<Item = &'n str>) {
        if let Assets::Built { chunks, .. } = self {
            chunks.preloads().islands_into(out, names);
        }
    }

    /// The `<script>`s that hydrate the page.
    pub fn scripts_into(&self, out: &mut String) {
        let mut script = |src: &str| {
            out.push_str("<script type=\"module\" src=\"");
            ferrovue::core::escape_into(out, src);
            out.push_str("\"></script>");
        };
        match self {
            Assets::Built { script: src, .. } => script(src),
            Assets::Dev(origin) => {
                script(&format!("{origin}/@vite/client"));
                script(&format!("{origin}/{ENTRY}"));
            }
            Assets::None => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_the_stylesheets_of_the_islands_the_entry_loads_lazily() {
        let dist = std::env::temp_dir().join(format!("ferrovue-assets-{}", std::process::id()));
        std::fs::create_dir_all(dist.join(".vite")).unwrap();
        let manifest = r#"{
            "client/main.ts": { "file": "assets/main.js", "isEntry": true, "css": ["assets/main.css"], "dynamicImports": ["client/components/A.vue", "client/components/B.vue"] },
            "client/components/A.vue": { "file": "assets/A.js", "css": ["assets/A.css"], "imports": ["client/main.ts", "_shared.js"] },
            "client/components/B.vue": { "file": "assets/B.js", "imports": ["client/main.ts", "_shared.js"] },
            "_shared.js": { "file": "assets/shared.js", "css": ["assets/shared.css"] }
        }"#;
        std::fs::write(dist.join(".vite/manifest.json"), manifest).unwrap();
        let islands = r#"{ "A": "assets/A.js" }"#;
        std::fs::write(dist.join(".vite/ferrovue-islands.json"), islands).unwrap();
        let assets = Assets::from_manifest(&dist);
        std::fs::remove_dir_all(&dist).unwrap();
        let mut styles = String::new();
        if let Ok(assets) = &assets {
            assets.styles_into(&mut styles);
        }
        let Ok(Assets::Built { script, chunks }) = assets else {
            panic!("no build: {assets:?}");
        };
        assert_eq!(script, "/assets/main.js");
        assert_eq!(
            styles,
            concat!(
                r#"<link rel="stylesheet" href="/assets/main.css">"#,
                r#"<link rel="stylesheet" href="/assets/A.css">"#,
                r#"<link rel="stylesheet" href="/assets/shared.css">"#,
            )
        );
        assert_eq!(
            chunks.for_islands(["A"]),
            ["/assets/A.js", "/assets/shared.js"]
        );
    }
}
