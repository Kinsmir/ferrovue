//! The client's scripts and styles: from Vite's manifest after `vite build`, or from Vite's dev
//! server while it runs.

use std::path::Path;

use serde::Deserialize;

/// The entry `vite.config.ts` builds, as the manifest keys it.
const ENTRY: &str = "client/main.ts";

/// Where the page loads the client from.
#[derive(Debug, Clone)]
pub enum Assets {
    /// The production build: the entry's hashed script and its stylesheets, served from `/assets`.
    Built {
        /// The entry script's URL.
        script: String,
        /// The stylesheets the entry imports, and those of the chunks it loads later: each island's
        /// own, which the page links up front so the server's markup is styled before it hydrates.
        styles: Vec<String>,
    },
    /// Vite's dev server at this origin (`http://localhost:5173`), which serves the sources and
    /// hot-reloads them.
    Dev(String),
    /// No client at all: the page renders, and nothing hydrates it.
    None,
}

/// One chunk in `.vite/manifest.json`.
#[derive(Deserialize)]
struct Chunk {
    file: String,
    #[serde(default)]
    css: Vec<String>,
    #[serde(default)]
    imports: Vec<String>,
    #[serde(default, rename = "dynamicImports")]
    dynamic_imports: Vec<String>,
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
        let manifest: std::collections::HashMap<String, Chunk> =
            serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
        let entry = manifest
            .get(ENTRY)
            .ok_or_else(|| format!("{} has no entry {ENTRY}", path.display()))?;
        // Every chunk the entry may load, statically or as an island (`ferrovue/islands` imports each
        // lazily), entry first: Vite would link an island's stylesheet only once its script loads.
        let mut seen = vec![ENTRY];
        let mut styles = Vec::new();
        let mut i = 0;
        while let Some(key) = seen.get(i) {
            i += 1;
            let Some(chunk) = manifest.get(*key) else {
                continue;
            };
            for css in &chunk.css {
                let href = format!("/{css}");
                if !styles.contains(&href) {
                    styles.push(href);
                }
            }
            for key in chunk.imports.iter().chain(&chunk.dynamic_imports) {
                if !seen.contains(&key.as_str()) {
                    seen.push(key);
                }
            }
        }
        Ok(Assets::Built {
            script: format!("/{}", entry.file),
            styles,
        })
    }

    /// The `<link>`s for the `<head>`. In development Vite injects the styles itself.
    pub fn styles_into(&self, out: &mut String) {
        if let Assets::Built { styles, .. } = self {
            for href in styles {
                out.push_str("<link rel=\"stylesheet\" href=\"");
                ferrovue::escape_into(out, href);
                out.push_str("\">");
            }
        }
    }

    /// The `<script>`s that hydrate the page.
    pub fn scripts_into(&self, out: &mut String) {
        let mut script = |src: &str| {
            out.push_str("<script type=\"module\" src=\"");
            ferrovue::escape_into(out, src);
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
        // As `vite build` writes it for `ferrovue/islands`: an island's chunk with a stylesheet of
        // its own, and a chunk two islands share with one.
        let manifest = r#"{
            "client/main.ts": { "file": "assets/main.js", "css": ["assets/main.css"], "dynamicImports": ["client/components/A.vue", "client/components/B.vue"] },
            "client/components/A.vue": { "file": "assets/A.js", "css": ["assets/A.css"], "imports": ["client/main.ts", "_shared.js"] },
            "client/components/B.vue": { "file": "assets/B.js", "imports": ["client/main.ts", "_shared.js"] },
            "_shared.js": { "file": "assets/shared.js", "css": ["assets/shared.css"] }
        }"#;
        std::fs::write(dist.join(".vite/manifest.json"), manifest).unwrap();
        let assets = Assets::from_manifest(&dist);
        std::fs::remove_dir_all(&dist).unwrap();
        let Ok(Assets::Built { script, styles }) = assets else {
            panic!("no build: {assets:?}");
        };
        assert_eq!(script, "/assets/main.js");
        assert_eq!(
            styles,
            ["/assets/main.css", "/assets/A.css", "/assets/shared.css"]
        );
    }
}
