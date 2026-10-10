use std::collections::{HashMap, HashSet};

use serde::Deserialize;

/// The chunks of a client build, read from Vite's manifest (`.vite/manifest.json`, written by
/// `vite build` with `build.manifest: true`): which scripts an island needs, so the page can name
/// them up front with `<link rel="modulepreload">` in place of the browser finding them one import
/// at a time once the client runs.
///
/// An island is found by its `NAME` through `.vite/ferrovue-islands.json`, which the Vite plugin
/// writes beside the manifest: the file of the chunk that holds each island. That is not always a
/// chunk of the island's own: one another chunk also imports is bundled into a chunk they share,
/// which the manifest does not key by the island's source. What a chunk needs is its own file
/// and, transitively, the chunks it imports statically; never an entry chunk, which the page's
/// `<script>` already loads, and not the chunks it imports dynamically, which it loads only when
/// it asks for them.
///
/// [`guide::islands_and_hydration`](crate::guide::islands_and_hydration#preloading-the-islands)
/// says where the links go.
///
/// # Example
///
/// ```
/// let manifest = r#"{
///     "client/main.ts": { "file": "assets/main.js", "isEntry": true, "imports": ["_vue.js"], "dynamicImports": ["client/components/Counter.vue"] },
///     "client/components/Counter.vue": { "file": "assets/Counter.js", "imports": ["_vue.js", "client/main.ts"] },
///     "_vue.js": { "file": "assets/vue.js" }
/// }"#;
/// let islands = r#"{ "Counter": "assets/Counter.js" }"#;
/// let chunks = ferrovue::Chunks::from_manifest(manifest, islands)?;
/// assert_eq!(chunks.for_islands(["Counter"]), ["/assets/Counter.js", "/assets/vue.js"]);
///
/// let mut preloads = chunks.preloads();
/// let mut out = String::new();
/// preloads.islands_into(&mut out, ["Counter"]);
/// preloads.islands_into(&mut out, ["Counter"]);
/// assert_eq!(
///     out,
///     r#"<link rel="modulepreload" href="/assets/Counter.js"><link rel="modulepreload" href="/assets/vue.js">"#
/// );
/// # Ok::<(), ferrovue::ManifestError>(())
/// ```
#[derive(Debug, Clone)]
pub struct Chunks {
    chunks: HashMap<String, Chunk>,
    islands: HashMap<String, String>,
    base: String,
}

/// The `<link rel="modulepreload">`s of one page, each URL written once however many islands
/// need it. Made by [`Chunks::preloads`].
#[derive(Debug)]
pub struct Preloads<'c> {
    chunks: &'c Chunks,
    linked: HashSet<&'c str>,
}

/// A manifest or a list of islands [`Chunks::from_manifest`] cannot read.
#[derive(Debug)]
pub struct ManifestError {
    what: &'static str,
    error: serde_json::Error,
}

#[derive(Debug, Clone, Deserialize)]
struct Chunk {
    file: String,
    #[serde(default)]
    imports: Vec<String>,
    #[serde(default, rename = "isEntry")]
    is_entry: bool,
}

impl Chunks {
    /// Read the texts of Vite's manifest (`.vite/manifest.json`) and of the islands the Vite
    /// plugin writes beside it (`.vite/ferrovue-islands.json`). URLs are the manifest's files
    /// under `/`; see [`with_base`](Self::with_base).
    ///
    /// # Errors
    ///
    /// When `manifest` is not a manifest (not JSON, or a chunk without its `file`), or `islands`
    /// is not an object of strings.
    pub fn from_manifest(manifest: &str, islands: &str) -> Result<Self, ManifestError> {
        let chunks: HashMap<String, Chunk> =
            serde_json::from_str(manifest).map_err(|error| ManifestError {
                what: "a Vite manifest",
                error,
            })?;
        let files: HashMap<String, String> =
            serde_json::from_str(islands).map_err(|error| ManifestError {
                what: "ferrovue's islands",
                error,
            })?;
        let keys: HashMap<&str, &str> = chunks
            .iter()
            .map(|(key, chunk)| (chunk.file.as_str(), key.as_str()))
            .collect();
        let islands = files
            .into_iter()
            .filter_map(|(name, file)| Some((name, (*keys.get(file.as_str())?).to_owned())))
            .collect();
        Ok(Chunks {
            chunks,
            islands,
            base: String::from("/"),
        })
    }

    /// Serve the files under `base`, Vite's `base`, ending in `/` (`"/static/"`,
    /// `"https://cdn.example.com/"`), in place of `/`.
    #[must_use]
    pub fn with_base(mut self, base: impl Into<String>) -> Self {
        self.base = base.into();
        self
    }

    /// The URLs the islands called `names` need, each once: an island's own chunk, then those
    /// it imports. A name that is no island of the build, or an island the manifest lacks, needs
    /// nothing.
    pub fn for_islands<'n>(&self, names: impl IntoIterator<Item = &'n str>) -> Vec<String> {
        let mut seen = HashSet::new();
        names
            .into_iter()
            .filter_map(|name| self.islands.get(name))
            .flat_map(|key| self.needed(key, &mut seen))
            .map(|file| self.url(file))
            .collect()
    }

    /// The URLs the chunk of the manifest's key `key` needs (a module the entry imports
    /// dynamically, such as `"client/app.ts"`): its own and those it imports, each once.
    pub fn for_source(&self, key: &str) -> Vec<String> {
        let Some((key, _)) = self.chunks.get_key_value(key) else {
            return Vec::new();
        };
        self.needed(key, &mut HashSet::new())
            .into_iter()
            .map(|file| self.url(file))
            .collect()
    }

    /// A page's links, which write each URL once.
    #[must_use]
    pub fn preloads(&self) -> Preloads<'_> {
        Preloads {
            chunks: self,
            linked: HashSet::new(),
        }
    }

    fn needed<'c>(&'c self, key: &'c str, seen: &mut HashSet<&'c str>) -> Vec<&'c str> {
        let mut files = Vec::new();
        let mut stack = vec![key];
        while let Some(key) = stack.pop() {
            if !seen.insert(key) {
                continue;
            }
            let Some(chunk) = self.chunks.get(key) else {
                continue;
            };
            if chunk.is_entry {
                continue;
            }
            files.push(chunk.file.as_str());
            stack.extend(chunk.imports.iter().rev().map(String::as_str));
        }
        files
    }

    fn url(&self, file: &str) -> String {
        format!("{}{file}", self.base)
    }
}

impl<'c> Preloads<'c> {
    /// Write a `<link rel="modulepreload">` for each chunk the islands called `names` need that
    /// this page has not linked yet.
    pub fn islands_into<'n>(&mut self, out: &mut String, names: impl IntoIterator<Item = &'n str>) {
        let chunks = self.chunks;
        for name in names {
            if let Some(key) = chunks.islands.get(name) {
                self.key_into(out, key);
            }
        }
    }

    /// Write a `<link rel="modulepreload">` for each chunk the manifest's key `key` needs that
    /// this page has not linked yet.
    pub fn source_into(&mut self, out: &mut String, key: &str) {
        if let Some((key, _)) = self.chunks.chunks.get_key_value(key) {
            self.key_into(out, key);
        }
    }

    fn key_into(&mut self, out: &mut String, key: &'c str) {
        let chunks = self.chunks;
        for file in chunks.needed(key, &mut HashSet::new()) {
            if self.linked.insert(file) {
                out.push_str("<link rel=\"modulepreload\" href=\"");
                crate::escape_into(out, &chunks.url(file));
                out.push_str("\">");
            }
        }
    }
}

impl std::fmt::Display for ManifestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "not {}: {}", self.what, self.error)
    }
}

impl std::error::Error for ManifestError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.error)
    }
}

#[cfg(test)]
mod tests;
