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
        /// The stylesheets the entry imports.
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
        let mut manifest: std::collections::HashMap<String, Chunk> =
            serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
        let entry = manifest
            .remove(ENTRY)
            .ok_or_else(|| format!("{} has no entry {ENTRY}", path.display()))?;
        Ok(Assets::Built {
            script: format!("/{}", entry.file),
            styles: entry.css.iter().map(|css| format!("/{css}")).collect(),
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
