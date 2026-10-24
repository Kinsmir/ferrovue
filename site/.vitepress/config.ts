import { execFileSync } from "node:child_process";
import { defineConfig, type HeadConfig } from "vitepress";
import { DOCS_RS, REPOSITORY, ROOT, SITE_URL, readGuide, sidebar, slugify } from "../guide.ts";

const TITLE = "ferrovue";
const DESCRIPTION = "Vue 3 single-file components compiled to Rust render functions whose output is byte-identical to Vue's renderToString.";

function committed(source: string): number | undefined {
  try {
    const seconds = execFileSync("git", ["log", "-1", "--format=%ct", "--", source], { cwd: ROOT, encoding: "utf8" }).trim();
    return seconds ? Number(seconds) * 1000 : undefined;
  } catch {
    return undefined;
  }
}

export default defineConfig({
  lang: "en",
  title: TITLE,
  titleTemplate: `:title | ${TITLE}`,
  description: DESCRIPTION,
  base: "/ferrovue/",
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: SITE_URL },
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/ferrovue/logo.svg" }],
    ["meta", { name: "theme-color", content: "#42b883" }],
    ["meta", { property: "og:site_name", content: TITLE }],
    ["meta", { name: "google-site-verification", content: "EP9MQbmTl1uj53ugZ8hnQfAPN1pQsvJH5D0GIJhUTao" }],
  ],
  markdown: {
    anchor: { slugify },
    attrs: false,
  },
  vite: { build: { chunkSizeWarningLimit: 1024 } },
  transformPageData(pageData) {
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, "");
    const url = SITE_URL + path;
    const home = pageData.frontmatter["layout"] === "home";
    const title = home ? pageData.title : `${pageData.title} | ${TITLE}`;
    const description = pageData.description || DESCRIPTION;
    const head: HeadConfig[] = [
      ["link", { rel: "canonical", href: url }],
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: description }],
      ["meta", { property: "og:url", content: url }],
      ["meta", { property: "og:type", content: home ? "website" : "article" }],
      ["meta", { name: "twitter:card", content: "summary" }],
    ];
    pageData.frontmatter["head"] = [...((pageData.frontmatter["head"] as HeadConfig[] | undefined) ?? []), ...head];
    const source = pageData.frontmatter["source"] as string | undefined;
    const updated = source ? committed(source) : undefined;
    if (updated) pageData.lastUpdated = updated;
  },
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Guide", link: "/guide/quick-start", activeMatch: "^/guide/" },
      { text: "API reference (docs.rs)", link: "https://docs.rs/ferrovue" },
      { text: "Changelog", link: "/changelog" },
      {
        text: "Packages",
        items: [
          { text: "npm: ferrovue", link: "https://www.npmjs.com/package/ferrovue" },
          { text: "crates.io: ferrovue", link: "https://crates.io/crates/ferrovue" },
          { text: "docs.rs: ferrovue", link: DOCS_RS },
        ],
      },
    ],
    sidebar: { "/guide/": sidebar(readGuide()) },
    outline: { level: [2, 3] },
    socialLinks: [{ icon: "github", link: REPOSITORY }],
    editLink: {
      pattern: ({ frontmatter, filePath }) => `https://github.com/Kinsmir/ferrovue/edit/main/${(frontmatter["source"] as string | undefined) ?? `site/${filePath}`}`,
      text: "Edit this page on GitHub",
    },
    search: { provider: "local" },
    footer: {
      message: `Released under the MIT or Apache-2.0 licence. <a href="${REPOSITORY}">Source on GitHub</a>.`,
    },
  },
});
