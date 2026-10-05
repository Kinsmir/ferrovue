export type Input = Record<string, unknown>;

/** One call: `useHead(input)` or `useSeoMeta(input)`. */
export type Call = { head: Input } | { seo: Input };

/** The calls of one render, and whether its head has unhead's defaults. */
export interface HeadCase {
  defaults: boolean;
  calls: Call[];
}

const HOSTILE = [
  "",
  "true",
  "false",
  "_null",
  "%s",
  "a %s b %s",
  "$& $' $` $$ $1",
  `"'<>&/`,
  "</title><script>alert(1)</script>",
  "</script></SCRIPT></style></noscript>",
  "a&amp;b &lt; &#x27;",
  " spaced  out ",
  "x:y",
  "og:image",
  "description",
  "viewport",
  "é 🦀   \u0007",
  "@import url(x.css)",
  "{\"a\":\"</script>\"}",
];

const NUMBERS = [0, -0, 1, -1, 1.5, 1e21, Number.NaN, Number.POSITIVE_INFINITY];

function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function own(entries: [string, unknown][]): Input {
  const o: Input = {};
  for (const [k, v] of entries) Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
  return o;
}

const hand: HeadCase[] = [
  { defaults: true, calls: [] },
  { defaults: false, calls: [] },
  { defaults: true, calls: [{ head: { title: "Dune" } }] },
  { defaults: false, calls: [{ head: { title: `"'<>&/ </title>` } }] },
  { defaults: false, calls: [{ head: { title: 42 } }, { head: { title: null } }] },
  { defaults: false, calls: [{ head: { title: "" } }] },
  { defaults: false, calls: [{ head: { title: true } }] },
  { defaults: false, calls: [{ head: { title: 0, titleTemplate: "[%s]" } }] },
  { defaults: false, calls: [{ head: { titleTemplate: "%s · Books %s" } }, { head: { title: "$& and $'" } }] },
  { defaults: false, calls: [{ head: { titleTemplate: "Books" } }] },
  { defaults: false, calls: [{ head: { titleTemplate: "" , title: "t" } }] },
  { defaults: false, calls: [{ head: { titleTemplate: null, title: "t" } }] },
  { defaults: false, calls: [{ head: { titleTemplate: 7, title: "t" } }] },
  { defaults: false, calls: [{ head: { title: "first" } }, { head: { title: "second", titleTemplate: "%s!" } }, { head: { titleTemplate: "<%s>" } }] },
  {
    defaults: true,
    calls: [
      { head: { meta: [{ name: "viewport", content: "width=500" }, { charset: "latin1" }], htmlAttrs: { lang: "fr", dir: "rtl" } } },
      { head: { meta: [{ "http-equiv": "content-security-policy", content: "default-src 'self'" }, { name: "description", content: "d" }] } },
    ],
  },
  {
    defaults: false,
    calls: [
      { head: { meta: [{ name: "description", content: "one" }, { name: "description", content: "two" }] } },
      { head: { meta: [{ name: "description", content: "three" }] } },
    ],
  },
  {
    defaults: false,
    calls: [
      { head: { meta: [{ property: "og:image", content: "a.png" }, { property: "og:image", content: "b.png" }, { property: "og:image:width", content: 100 }] } },
      { head: { meta: [{ property: "og:image", content: "c.png" }] } },
      { head: { meta: [{ name: "theme-color", content: "red", media: "(prefers-color-scheme: light)" }, { name: "theme-color", content: "black" }] } },
    ],
  },
  { defaults: false, calls: [{ head: { meta: [{ property: "og:image", content: ["x.png", "", "true", 0, null] }, { name: "keywords", content: ["a", "b"] }] } }] },
  {
    defaults: false,
    calls: [
      { head: { meta: [{ name: "a", content: "" }, { name: "b", content: 0 }, { name: "c", content: Number.NaN }, { name: "d", content: null }, { name: "e", content: true }, { name: "f", content: "true" }, { name: "g", content: false }, { name: "h" }] } },
    ],
  },
  { defaults: false, calls: [{ head: { meta: [{ name: "author", content: "x", key: "k" }, { name: "author", content: "y", key: "k" }, { name: "x:y", content: "z", key: "k" }, { name: "x:y", content: "w", key: "k" }] } }] },
  { defaults: false, calls: [{ head: { meta: [{ name: "robots", content: "noindex", key: "r" }] } }, { head: { meta: [{ name: "robots", content: "index", key: "q" }] } }] },
  { defaults: false, calls: [{ head: { meta: [{ name: 5, content: "five" }, { name: "", content: "empty" }, { property: true, content: "t" }] } }] },
  {
    defaults: false,
    calls: [
      {
        head: {
          link: [
            { rel: "canonical", href: "/a" },
            { rel: "stylesheet", href: "/s.css" },
            { rel: "preload", href: "/f.woff2", as: "font", crossorigin: "" },
            { rel: "modulepreload", href: "/m.js" },
            { rel: "prefetch", href: "/p" },
            { rel: "dns-prefetch", href: "//cdn" },
            { rel: "preconnect", href: "https://cdn" },
            { rel: "icon", href: "/i.png" },
            { rel: "alternate", hreflang: "de", href: "/de" },
            { rel: "alternate", hreflang: "de", href: "/de2" },
            { rel: "icon", href: "/i.png" },
            { href: "/norel" },
          ],
        },
      },
      { head: { link: [{ rel: "canonical", href: "/b" }, { rel: "stylesheet", href: "/s.css", media: "print" }] } },
    ],
  },
  { defaults: false, calls: [{ head: { link: [{ rel: "stylesheet", href: "/a.css", key: "main" }] } }, { head: { link: [{ rel: "stylesheet", media: "screen", key: "main" }] } }] },
  { defaults: false, calls: [{ head: { link: [{ rel: "icon", href: "/a", id: "fav" }] } }, { head: { link: [{ rel: "icon", href: "/b", id: "fav", tagDuplicateStrategy: "merge", sizes: "32x32" }] } }] },
  {
    defaults: false,
    calls: [
      {
        head: {
          script: [
            { src: "/a.js", async: true },
            { src: "/b.js", defer: true },
            { src: "/c.js", type: "module" },
            { src: "/d.js" },
            { innerHTML: "console.log('</script>', '</SCRIPT>')" },
            { type: "importmap", innerHTML: { imports: { a: "/a.js<" } } },
            { type: "speculationrules", innerHTML: { prerender: [{ where: { href_matches: "/*" } }] } },
            { type: "application/ld+json", innerHTML: { "@type": "Thing", name: "</script><b>", n: 1.5, z: null, u: undefined, list: [1, "two", null] } },
            { type: "application/json", textContent: "{\"a\":\"<b>\"}" },
            { textContent: "late()", tagPosition: "bodyClose" },
            { textContent: "early()", tagPosition: "bodyOpen" },
            { textContent: "nowhere()", tagPosition: "elsewhere" },
            { textContent: "head()", tagPosition: "head" },
            { src: "/e.js", async: "", key: "e" },
            { src: "/e2.js", key: "e" },
            { innerHTML: "x", type: "text/x-template" },
          ],
        },
      },
    ],
  },
  {
    defaults: false,
    calls: [
      { head: { style: [{ textContent: "@import url(a.css); b{}" }, { innerHTML: "a{} </style><b>", media: "print" }, "c{}"], noscript: [{ textContent: "</noscript><img>" }, "plain"] } },
      { head: { style: ["c{}"] } },
    ],
  },
  {
    defaults: false,
    calls: [
      { head: { meta: [{ name: "low", content: "l", tagPriority: "low" }, { name: "high", content: "h", tagPriority: "high" }, { name: "crit", content: "c", tagPriority: "critical" }, { name: "n", content: "n", tagPriority: -50 }, { name: "m", content: "m", tagPriority: 10.5 }] } },
      { head: { title: "t", base: { href: "/" } } },
    ],
  },
  { defaults: false, calls: [{ head: { base: { href: "/a", target: "_blank" } } }, { head: { base: { href: "/b" } } }] },
  {
    defaults: true,
    calls: [
      { head: { htmlAttrs: { class: "a b  c", style: "color: red; margin : 0;bad;:x", "data-x": "", "data-y": "false", "data-z": false, hidden: "", translate: "true", Lang: "nl", spellcheck: false, contenteditable: null } } },
      { head: { htmlAttrs: { class: ["b", "d", ""], style: { color: "blue", "font-size": 12, display: false, top: "false" } } } },
      { head: { htmlAttrs: { class: { e: true, f: false, "g h": 1, i: "false" } }, bodyAttrs: { class: "body", "data-n": 0, "bad name": "x", "a\"b": "y", "on-click": "z", onload: "alert(1)" } } },
    ],
  },
  { defaults: false, calls: [{ head: { htmlAttrs: { "data-q": `"'<>&` , title: 1e21, tabindex: -0, value: Number.NaN }, bodyAttrs: { class: `x"y` } } }] },
  { defaults: false, calls: [{ head: own([["title", "own"], ["__proto__", { title: "proto" }], ["meta", [own([["name", "n"], ["content", "c"], ["constructor", "k"]])]]]) }] },
  { defaults: false, calls: [{ head: { "2": "two", "1": "one", meta: [{ "1": "x", name: "n", content: "c" }] } }] },
  { defaults: false, calls: [{ head: { templateParams: { site: "S" }, title: "%site", titleTemplate: "%s %site" } }] },
  { defaults: false, calls: [{ head: { meta: [{ name: "a", content: "1" }], link: [{ rel: "x", href: "y" }] } }, { head: { meta: [{ name: "a", content: "2" }] } }, { head: { meta: [{ name: "a", content: "3" }] } }] },
  {
    defaults: true,
    calls: [
      {
        seo: {
          title: "Seo",
          titleTemplate: "%s | Site",
          description: "d",
          ogTitle: "o",
          ogDescription: "",
          ogImage: "i.png",
          ogImageUrl: "u.png",
          ogImageWidth: 1200,
          ogSiteName: "s",
          twitterCard: "summary_large_image",
          twitterTitle: true,
          robots: "noindex",
          refresh: "5;url=/x",
          contentSecurityPolicy: "default-src 'self'",
          contentType: "text/html; charset=utf-8",
          xUaCompatible: "IE=edge",
          charset: "utf-16",
          themeColor: "#fff",
          author: "a",
          fbAppId: "123",
          msapplicationTileColor: "#000",
          articleTag: "t",
          articlePublishedTime: "2024",
          profileFirstName: "F",
          bookIsbn: "978",
          fediverseCreator: "@a@b",
          applicationName: "App",
          colorScheme: "dark",
          googleSiteVerification: "g",
          appleMobileWebAppCapable: "yes",
          defaultStyle: "s",
          paymentSuccessUrl: "/ok",
        },
      },
    ],
  },
  { defaults: false, calls: [{ seo: { description: null, ogTitle: "_null", ogDescription: false, ogType: 0, ogUrl: Number.NaN, ogLocale: undefined, charset: null } }] },
  { defaults: false, calls: [{ head: { meta: [{ name: "description", content: "head" }], title: "h" } }, { seo: { description: "seo", title: "s" } }, { head: { meta: [{ name: "description", content: "after" }] } }] },
  { defaults: false, calls: [{ seo: { ogImage: "a.png" } }, { seo: { ogImage: "b.png", twitterImage: "c.png" } }] },
  { defaults: false, calls: [{ seo: { title: "only" } }, { seo: {} }] },
  { defaults: false, calls: [{ head: { htmlAttrs: { "data-list": ["a", null, undefined, "b"], title: [1, 2] } } }] },
  { defaults: false, calls: [{ head: { meta: [{ name: "a", content: "1" }, { name: "b", content: "2" }] } }, { head: { meta: [{ name: "c", content: "3" }] } }] },
  { defaults: false, calls: [{ head: { link: [["x", "y"]], htmlAttrs: [["z"]] } }] },
  { defaults: false, calls: [{ head: { bodyAttrs: { Foo: "x", "DATA-Y": "y" } } }] },
  { defaults: false, calls: [{ head: { title: { textContent: "t", Foo: "x", "": "e", "a b": "s", tagPosition: null } } }] },
  { defaults: false, calls: [{ head: { link: [{ "bad name": "x" }, { "": "y" }] } }] },
  { defaults: false, calls: [{ head: { link: [{ rel: "icon", href: "/a", id: "fav", media: "m" }] } }, { head: { link: [{ rel: "icon", href: "/b", id: "fav", tagDuplicateStrategy: "merge" }] } }] },
  { defaults: false, calls: [{ head: { link: [{ rel: "icon", href: "/a", key: "k", media: "m" }] } }, { head: { link: [{ rel: "icon", href: "/b", key: "k", tagDuplicateStrategy: "replace" }] } }] },
  { defaults: false, calls: [{ head: { meta: [{ name: "x", content: "1", tagPriority: "bogus" }, { name: "y", content: "2" }] } }] },
  { defaults: false, calls: [{ head: { meta: [{ name: "n", content: "c" }], script: [{ defer: true }, { src: "/x.json", type: "application/json" }] } }] },
  { defaults: false, calls: [{ head: { link: [{ rel: "alternate", href: "/x", media: "a" }, { rel: "alternate", href: "/x", media: "b" }, { rel: "x", hreflang: "de", href: "/a" }, { rel: "x", hreflang: "de", href: "/b" }] } }] },
  { defaults: false, calls: [{ head: { meta: [{ name: 5, content: "a", key: "k1" }, { name: 5, content: "b", key: "k2" }, { name: "a", content: "c", key: "k1" }, { name: "a", content: "d", key: "k2" }] } }] },
  { defaults: false, calls: [{ head: { link: [{ rel: "x", href: 0, media: "a" }, { rel: "x", href: 0, media: "b" }] } }] },
  { defaults: false, calls: [{ head: { meta: [{ content: "a", textContent: "x" }] } }, { head: { meta: [{ content: "b", textContent: "x" }] } }, { head: { meta: [{ content: "c", textContent: 1 }] } }, { head: { meta: [{ content: "d", textContent: 1 }] } }, { head: { meta: [{ content: "e", textContent: 2 }] } }, { head: { meta: [{ content: "f", textContent: true }] } }, { head: { meta: [{ content: "g", textContent: true }] } }] },
  { defaults: false, calls: [{ head: { link: [{ "data-a": "1data-b:2" }, { "data-a": "1", "data-b": "2" }] } }] },
  { defaults: false, calls: [{ head: { meta: [{ name: "description", key: ["k"], content: "a", media: "m" }] } }, { head: { meta: [{ name: "description", key: ["k"], content: "b" }] } }] },
  { defaults: false, calls: [{ head: { meta: [{ name: "a", content: "1", tagPriority: 5 }, { name: "z", content: "2", tagPriority: Number.NaN }, { name: "a", content: "3", tagPriority: 3 }] } }] },
  { defaults: false, calls: [{ head: { meta: [{ name: "description", key: 1, content: "a", media: "m" }] } }, { head: { meta: [{ name: "description", key: 1, content: "b" }] } }] },
];

const TAGS = ["meta", "link", "script", "style", "noscript", "base", "htmlAttrs", "bodyAttrs", "title", "titleTemplate"] as const;
const ATTRS = ["name", "property", "http-equiv", "content", "charset", "rel", "href", "hreflang", "id", "media", "type", "src", "async", "defer", "data-a", "lang", "dir", "class", "style", "key", "tagPosition", "tagPriority"];
const SEO_KEYS = ["title", "titleTemplate", "description", "ogTitle", "ogImage", "ogImageUrl", "twitterCard", "twitterImage", "robots", "refresh", "charset", "themeColor", "author", "articleTag", "contentType", "fbAppId", "msapplicationConfig"];

function pick<T>(rand: () => number, of: readonly T[]): T {
  return of[Math.floor(rand() * of.length)]!;
}

function scalar(rand: () => number): unknown {
  const r = rand();
  if (r < 0.6) return pick(rand, HOSTILE);
  if (r < 0.75) return pick(rand, NUMBERS);
  if (r < 0.85) return rand() < 0.5;
  if (r < 0.93) return null;
  return undefined;
}

function attrValue(rand: () => number, attr: string): unknown {
  switch (attr) {
    case "class":
      return rand() < 0.5 ? pick(rand, HOSTILE) : [pick(rand, HOSTILE), pick(rand, HOSTILE)];
    case "style":
      return rand() < 0.5 ? `${pick(rand, ["color", "margin", "x"])}: ${pick(rand, HOSTILE)}` : { color: pick(rand, HOSTILE), top: rand() < 0.5 };
    case "key":
      return pick(rand, ["k", "j", "x:y", ""]);
    case "tagPosition":
      return pick(rand, ["head", "bodyClose", "bodyOpen"]);
    case "tagPriority":
      return pick(rand, ["critical", "high", "low", 5, -20, 100]);
    case "rel":
      return pick(rand, ["canonical", "stylesheet", "preload", "preconnect", "alternate", "icon", "x"]);
    case "name":
      return pick(rand, ["description", "viewport", "author", "og:image", "theme-color", "x:y", "n"]);
    case "content":
      return rand() < 0.15 ? [scalar(rand), scalar(rand)] : scalar(rand);
    default:
      return scalar(rand);
  }
}

function tagInput(rand: () => number, tag: string): unknown {
  if (tag === "title" || tag === "titleTemplate") return rand() < 0.8 ? pick(rand, HOSTILE) : scalar(rand);
  const n = 1 + Math.floor(rand() * 4);
  const entries: [string, unknown][] = [];
  for (let i = 0; i < n; i++) {
    const attr = pick(rand, ATTRS);
    if (entries.some(([k]) => k === attr)) continue;
    entries.push([attr, attrValue(rand, attr)]);
  }
  if (["script", "style", "noscript"].includes(tag) && rand() < 0.7) entries.push([rand() < 0.5 ? "innerHTML" : "textContent", pick(rand, HOSTILE)]);
  return Object.fromEntries(entries);
}

function randomCase(rand: () => number): HeadCase {
  const calls: Call[] = [];
  const count = 1 + Math.floor(rand() * 3);
  for (let c = 0; c < count; c++) {
    if (rand() < 0.2) {
      const seo: Input = {};
      for (let i = 0; i < 4; i++) seo[pick(rand, SEO_KEYS)] = scalar(rand);
      calls.push({ seo });
      continue;
    }
    const head: Input = {};
    for (let i = 0; i < 1 + Math.floor(rand() * 4); i++) {
      const tag = pick(rand, TAGS);
      const many = ["meta", "link", "script", "style", "noscript"].includes(tag);
      head[tag] = many ? Array.from({ length: 1 + Math.floor(rand() * 3) }, () => tagInput(rand, tag)) : tagInput(rand, tag);
    }
    calls.push({ head });
  }
  return { defaults: rand() < 0.3, calls };
}

/** Every case `head.json` records. */
export function headCases(): HeadCase[] {
  const rand = prng(20261005);
  return [...hand, ...Array.from({ length: 400 }, () => randomCase(rand))];
}
