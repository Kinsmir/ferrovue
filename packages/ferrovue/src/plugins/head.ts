import { type Component, type N, type Scope, type Val, absence, fail, rustStr } from "../model.ts";
import { describeTy, expr } from "../expr.ts";
import { arrow, items } from "../lists.ts";
import { bare, strArg } from "../parens.ts";
import { type Plugin, runOf, scopeOf } from "../plugin.ts";

type Composable = "head" | "seo" | "safe";

const COMPOSABLES: Record<string, Composable> = {
  useHead: "head",
  useServerHead: "head",
  useSeoMeta: "seo",
  useServerSeoMeta: "seo",
  useHeadSafe: "safe",
  useServerHeadSafe: "safe",
};

interface HeadScope {
  composables: Map<string, Composable>;
  calls: { kind: "head" | "seo"; call: N }[];
}

const TAG_LISTS = new Set(["meta", "link", "script", "style", "noscript"]);
const ATTR_OBJECTS = new Set(["htmlAttrs", "bodyAttrs", "base"]);
const WITH_CONTENT = new Set(["script", "style", "noscript"]);
const POSITIONS = new Set(["head", "bodyClose", "bodyOpen"]);
const PRIORITIES = new Set(["critical", "high", "low"]);
const STRATEGIES = new Set(["replace", "merge"]);
const OBJECT_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype));

const META_NAMESPACES = new Set(["twitter", "fediverse"]);
const PROPERTY_NAMESPACES = new Set(["og", "book", "article", "profile", "fb", "payment"]);
const HTTP_EQUIV_KEYS = new Set(["contentType", "defaultStyle", "xUaCompatible", "refresh", "contentSecurityPolicy"]);
const META_ALIASES: Record<string, string> = {
  articleExpirationTime: "article:expiration_time",
  articleModifiedTime: "article:modified_time",
  articlePublishedTime: "article:published_time",
  bookReleaseDate: "book:release_date",
  fbAppId: "fb:app_id",
  ogAudioSecureUrl: "og:audio:secure_url",
  ogAudioUrl: "og:audio",
  ogImageSecureUrl: "og:image:secure_url",
  ogImageUrl: "og:image",
  ogSiteName: "og:site_name",
  ogVideoSecureUrl: "og:video:secure_url",
  ogVideoUrl: "og:video",
  paymentExpiresAt: "payment:expires_at",
  paymentSuccessUrl: "payment:success_url",
  profileFirstName: "profile:first_name",
  profileLastName: "profile:last_name",
  profileUsername: "profile:username",
  msapplicationConfig: "msapplication-Config",
  msapplicationTileColor: "msapplication-TileColor",
  msapplicationTileImage: "msapplication-TileImage",
};

function fixKeyCase(key: string): string {
  const updated = key.replace(/([A-Z])/g, "-$1").toLowerCase();
  const prefix = updated.indexOf("-");
  if (prefix === -1) return updated;
  const ns = updated.slice(0, prefix);
  return META_NAMESPACES.has(ns) || PROPERTY_NAMESPACES.has(ns) ? key.replace(/([A-Z])/g, ":$1").toLowerCase() : updated;
}

/** The meta tag `useSeoMeta` writes for a key with a string value: the attribute it sets, and the
 * name it gives (`ogTitle` is `property="og:title"`). */
export function seoMetaKey(key: string): [attr: string, name: string] {
  if (key === "charset") return ["charset", ""];
  const name = Object.hasOwn(META_ALIASES, key) ? META_ALIASES[key]! : fixKeyCase(key);
  if (HTTP_EQUIV_KEYS.has(key)) return ["http-equiv", name];
  const fixed = fixKeyCase(key);
  const colon = fixed.indexOf(":");
  return [colon !== -1 && PROPERTY_NAMESPACES.has(fixed.slice(0, colon)) ? "property" : "name", name];
}

function keyOf(comp: Component, p: N): string {
  if (p.type !== "ObjectProperty" || p.computed) {
    fail(comp, "FV1704", "a head input is an object literal of plain keys and values: no spread, computed key or method", p);
  }
  const key: string = p.key.type === "Identifier" ? p.key.name : p.key.type === "StringLiteral" ? p.key.value : String(p.key.value);
  if (key === "__proto__") fail(comp, "FV1704", "`__proto__` sets an object's prototype in JavaScript, and is not a key of the head", p);
  return key;
}

function getter(s: Scope, n: N): N {
  if (n?.type === "ArrowFunctionExpression" || n?.type === "FunctionExpression") {
    const body = n.body?.type === "BlockStatement" ? (n.body.body.length === 1 && n.body.body[0].type === "ReturnStatement" ? n.body.body[0].argument : null) : n.body;
    if (n.params.length || n.async || n.generator || !body) {
      fail(s.comp, "FV1705", "a function in a head input is a getter of its value, `() => props.title`, which the server calls; one taking arguments runs only on the client", n);
    }
    return getter(s, body);
  }
  if (n?.type === "TSAsExpression" || n?.type === "TSSatisfiesExpression") return getter(s, n.expression);
  return n;
}

function scalar(s: Scope, v: Val, n: N, where: string): string {
  switch (v.ty.k) {
    case "str":
      return `fv::HeadValue::str(${strArg(v.code)})`;
    case "int":
      return `fv::HeadValue::int(${bare(v.code)})`;
    case "float":
      return `fv::HeadValue::float(${bare(v.code)})`;
    case "bool":
      return `fv::HeadValue::bool(${bare(v.code)})`;
    case "undef":
      return "fv::HeadValue::Undefined";
    case "null":
      return "fv::HeadValue::Null";
    case "opt": {
      const none = absence(v.ty);
      if (none === "either") fail(s.comp, "FV1706", `${where} may be \`undefined\` or \`null\`, which unhead treats apart and its Rust type cannot tell apart`, n);
      return `if let Some(v) = ${v.code} { ${scalar(s, { code: "v", ty: v.ty.of }, n, where)} } else { fv::HeadValue::${none === "null" ? "Null" : "Undefined"} }`;
    }
    default:
      return fail(s.comp, "FV1706", `${where} is ${describeTy(v.ty)}: a head value here is a string, a number or a boolean`, n);
  }
}

function value(s: Scope, raw: N, where: string, lists: boolean): string {
  const n = getter(s, raw);
  const v = expr(s, n);
  if (v.ty.k === "list" && lists) {
    const of = v.ty.of;
    const each = scalar(s, { code: of.k === "str" ? "&*v" : "v", ty: of }, n, `an item of ${where}`);
    return `fv::HeadValue::Array(${items(v)}.map(|v| ${each}).collect())`;
  }
  return scalar(s, v, n, where);
}

function objectOf(entries: string[]): string {
  return entries.length ? `fv::HeadValue::object([${entries.join(", ")}])` : "fv::HeadValue::Object(Vec::new())";
}

function object(s: Scope, raw: N, where: string, field: (key: string, value: N, p: N) => string): string {
  const n = getter(s, raw);
  if (n?.type !== "ObjectExpression") fail(s.comp, "FV1706", `${where} is an object literal`, n ?? raw);
  return objectOf(
    n.properties.map((p: N) => {
      const key = keyOf(s.comp, p);
      return `(${rustStr(key)}, ${field(key, p.value, p)})`;
    }),
  );
}

function floatLiteral(x: number): string {
  const spelled = String(x).replace("e+", "e");
  return `${/[.e]/.test(spelled) ? spelled : `${spelled}.0`}_f64`;
}

function literal(s: Scope, n: N, allowed: Set<string> | "number", key: string): string {
  const v = getter(s, n);
  if (allowed === "number") {
    if (v?.type === "NumericLiteral") return `fv::HeadValue::Number(${floatLiteral(v.value)})`;
    if (v?.type === "UnaryExpression" && v.operator === "-" && v.argument.type === "NumericLiteral") return `fv::HeadValue::Number(-${floatLiteral(v.argument.value)})`;
    if (v?.type === "StringLiteral" && PRIORITIES.has(v.value)) return `fv::HeadValue::str(${rustStr(v.value)})`;
    return fail(s.comp, "FV1707", `\`${key}\` is a number literal or one of ${[...PRIORITIES].map((p) => `"${p}"`).join(", ")}`, v ?? n);
  }
  if (v?.type !== "StringLiteral" || !allowed.has(v.value)) fail(s.comp, "FV1707", `\`${key}\` is one of ${[...allowed].map((p) => `"${p}"`).join(", ")}, written as a literal`, v ?? n);
  return `fv::HeadValue::str(${rustStr(v.value)})`;
}

function json(s: Scope, raw: N, where: string): string {
  const n = getter(s, raw);
  if (n?.type === "ObjectExpression") return object(s, n, where, (_key, v) => json(s, v, where));
  if (n?.type === "ArrayExpression") {
    const parts = n.elements.map((el: N) => {
      if (!el || el.type === "SpreadElement") fail(s.comp, "FV1704", "an array in a head input holds plain values: no hole or spread", n);
      return json(s, el, where);
    });
    return `fv::HeadValue::array([${parts.join(", ")}])`;
  }
  return value(s, n, where, true);
}

function tagObject(s: Scope, tag: string, raw: N): string {
  return object(s, raw, `a \`${tag}\` entry`, (key, v, p) => {
    if (key === "key") return value(s, v, "`key`", false);
    if (key === "tagPosition") return literal(s, v, POSITIONS, key);
    if (key === "tagPriority") return literal(s, v, "number", key);
    if (key === "tagDuplicateStrategy") return literal(s, v, STRATEGIES, key);
    if (key === "processTemplateParams") return fail(s.comp, "FV1703", "`processTemplateParams` needs unhead's template params plugin, which ferrovue does not reproduce", p);
    if (key === "innerHTML" || key === "textContent") {
      if (!WITH_CONTENT.has(tag)) fail(s.comp, "FV1711", `\`${key}\` on a \`${tag}\`, which has no content: only \`script\`, \`style\` and \`noscript\` take it`, p);
      return tag === "script" ? json(s, v, `\`${key}\``) : value(s, v, `\`${key}\``, false);
    }
    if (key.startsWith("on") && (v.type === "ArrowFunctionExpression" || v.type === "FunctionExpression")) {
      fail(s.comp, "FV1705", `\`${key}\` is an event handler, which runs only on the client`, p);
    }
    if (key === "class" || key === "style") return classOrStyle(s, key, v);
    return value(s, v, `\`${key}\``, tag === "meta" && key === "content");
  });
}

function classOrStyle(s: Scope, key: string, raw: N): string {
  const n = getter(s, raw);
  const where = `\`${key}\``;
  if (n?.type === "ObjectExpression") return object(s, n, where, (_k, v) => value(s, v, `a value of ${where}`, false));
  if (n?.type === "ArrayExpression") {
    const parts = n.elements.map((el: N) => {
      if (!el || el.type === "SpreadElement") fail(s.comp, "FV1704", "an array in a head input holds plain values: no hole or spread", n);
      return strict(s, el, `an item of ${where}`);
    });
    return `fv::HeadValue::array([${parts.join(", ")}])`;
  }
  const v = expr(s, n);
  if (absence(v.ty) === "null" || absence(v.ty) === "either") fail(s.comp, "FV1710", `${where} may be \`null\`, on which unhead's renderer throws; write \`?? undefined\``, n);
  if (v.ty.k === "list" && (v.ty.of.k === "str")) return `fv::HeadValue::Array(${items(v)}.map(|v| fv::HeadValue::str(&*v)).collect())`;
  if (v.ty.k !== "str" && !(v.ty.k === "opt" && v.ty.of.k === "str") && v.ty.k !== "undef") fail(s.comp, "FV1706", `${where} is a string, a list of strings or an object literal`, n);
  return scalar(s, v, n, where);
}

function strict(s: Scope, raw: N, where: string): string {
  const n = getter(s, raw);
  const v = expr(s, n);
  if (v.ty.k !== "str") fail(s.comp, "FV1706", `${where} is a string`, n);
  return scalar(s, v, n, where);
}

function tagList(s: Scope, tag: string, raw: N): string {
  const n = getter(s, raw);
  if (n?.type === "ObjectExpression") return tagObject(s, tag, n);
  if (n?.type === "ArrayExpression") {
    const parts = n.elements.map((el: N) => {
      if (!el || el.type === "SpreadElement") fail(s.comp, "FV1704", "an array in a head input holds plain values: no hole or spread", n);
      return tagObject(s, tag, el);
    });
    return `fv::HeadValue::array([${parts.join(", ")}])`;
  }
  const mapped = n?.type === "CallExpression" && n.callee.type === "MemberExpression" && !n.callee.computed && n.callee.property.name === "map" && n.arguments.length === 1 ? n : null;
  if (mapped) {
    const list = expr(s, mapped.callee.object);
    if (list.ty.k !== "list") fail(s.comp, "FV1706", `\`${tag}\` maps a list`, mapped.callee.object);
    const fn = mapped.arguments[0];
    const { closure, enumerate } = arrow(s, fn, list, list.ty.of, false, "map", (inner) => tagObject(inner, tag, fn.body));
    return `fv::HeadValue::Array(${items(list)}${enumerate ? ".enumerate()" : ""}.map(${closure}).collect())`;
  }
  return fail(s.comp, "FV1706", `\`${tag}\` is an array of object literals, an object literal, or a list's \`.map(x => ({ … }))\``, n ?? raw);
}

function titleTemplate(s: Scope, v: N): string {
  if (v.type === "ArrowFunctionExpression" || v.type === "FunctionExpression") fail(s.comp, "FV1705", "a `titleTemplate` function runs with the title; write a string with `%s`", v);
  return value(s, v, "`titleTemplate`", false);
}

function headInput(s: Scope, raw: N): string {
  const n = getter(s, raw);
  if (n?.type !== "ObjectExpression") fail(s.comp, "FV1702", "`useHead` takes an object literal, or a getter returning one", raw);
  return object(s, n, "the head input", (key, v, p) => {
    if (key === "title") return value(s, v, "`title`", false);
    if (key === "titleTemplate") return titleTemplate(s, v);
    if (TAG_LISTS.has(key)) return tagList(s, key, v);
    if (ATTR_OBJECTS.has(key)) return tagObject(s, key, v);
    if (key === "templateParams") return fail(s.comp, "FV1703", "`templateParams` needs unhead's template params plugin, which ferrovue does not reproduce", p);
    return fail(s.comp, "FV1703", `\`${key}\` is not a key of the head ferrovue translates: \`title\`, \`titleTemplate\`, \`base\`, \`meta\`, \`link\`, \`script\`, \`style\`, \`noscript\`, \`htmlAttrs\` and \`bodyAttrs\` are`, p);
  });
}

function seoMeta(s: Scope, raw: N): string {
  const n = getter(s, raw);
  if (n?.type !== "ObjectExpression") fail(s.comp, "FV1702", "`useSeoMeta` takes an object literal, or a getter returning one", raw);
  const input: (string | undefined)[] = [];
  const meta = new Map<string, string>();
  for (const p of n.properties) {
    const key = keyOf(s.comp, p);
    if (key === "title" || key === "titleTemplate") {
      input[key === "title" ? 0 : 1] = `(${rustStr(key)}, ${key === "title" ? value(s, p.value, "`title`", false) : titleTemplate(s, p.value)})`;
      continue;
    }
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key) || OBJECT_KEYS.has(key) || key === "class" || key === "style" || key === "key" || key.startsWith("tag") || key === "innerHTML" || key === "textContent" || key === "processTemplateParams") {
      fail(s.comp, "FV1709", `\`${key}\` is not a key of \`useSeoMeta\` ferrovue translates: its keys are camel-case names, as \`description\` or \`ogTitle\``, p);
    }
    const v = getter(s, p.value);
    if (v.type === "ObjectExpression" || v.type === "ArrayExpression") {
      fail(s.comp, "FV1709", `\`${key}\` given an object or an array, which \`useSeoMeta\` unpacks into tags ferrovue does not reproduce; write its string`, p.value);
    }
    const [attr, name] = seoMetaKey(key);
    meta.set(key, `(${rustStr(attr)}, ${rustStr(name)}, ${value(s, v, `\`${key}\``, false)})`);
  }
  return `${objectOf(input.filter((i) => i !== undefined))}, vec![${[...meta.values()].join(", ")}]`;
}

function composableCall(s: Scope, n: N): { kind: Composable; call: N } | null {
  if (n?.type !== "CallExpression" || n.callee.type !== "Identifier") return null;
  const kind = scopeOf(head, s).composables.get(n.callee.name);
  return kind ? { kind, call: n } : null;
}

function record(s: Scope, found: { kind: Composable; call: N }): void {
  const { kind, call } = found;
  if (kind === "safe") fail(s.comp, "FV1708", "`useHeadSafe` filters its input through unhead's safe input plugin, which ferrovue does not reproduce; use `useHead` with values the page trusts", call);
  if (call.arguments.length > 1) fail(s.comp, "FV1701", "`useHead`'s options are not translated: give the input alone", call.arguments[1]);
  scopeOf(head, s).calls.push({ kind, call });
}

export const head: Plugin<Set<Component>, HeadScope> = {
  name: "head",
  configure: () => new Set(),
  compiled(comp, _code, script) {
    for (const st of script) {
      if (st.type !== "ImportDeclaration" || st.source.value !== "@unhead/vue" || st.importKind === "type") continue;
      if (st.specifiers.some((sp: N) => sp.type === "ImportSpecifier" && sp.importKind !== "type" && Object.hasOwn(COMPOSABLES, sp.imported.name ?? sp.imported.value))) {
        runOf(head).add(comp);
      }
    }
  },
  scope: () => ({ composables: new Map(), calls: [] }),
  scriptImport(s, st, from) {
    if (from !== "@unhead/vue") return false;
    for (const sp of st.specifiers) {
      if (st.importKind === "type" || sp.importKind === "type") continue;
      const name: string | null = sp.type === "ImportSpecifier" ? (sp.imported.name ?? sp.imported.value) : null;
      if (name !== null && Object.hasOwn(COMPOSABLES, name)) s.clientOnly.delete(sp.local.name);
      if (name !== null && Object.hasOwn(COMPOSABLES, name)) scopeOf(head, s).composables.set(sp.local.name, COMPOSABLES[name]!);
      else s.clientOnly.set(sp.local.name, `\`${name ?? sp.local.name}\` from \`@unhead/vue\` runs on the client`);
    }
    return true;
  },
  scriptStatement(s, st) {
    const found = composableCall(s, st.expression);
    if (!found) return false;
    record(s, found);
    return true;
  },
  scriptBinding(s, d) {
    const found = composableCall(s, d.init);
    if (!found) return false;
    record(s, found);
    for (const name of d.id.type === "Identifier" ? [d.id.name] : []) s.clientOnly.set(name, "the entry `useHead` returns is for the client, which patches and disposes it");
    return true;
  },
  loadedLater: (child) => (child.takes.has("fv_head") ? ["let _fv_later = fv_head.deferred();"] : []),
  prelude(s) {
    const after = scopeOf(head, s).calls.map(({ kind, call }) =>
      kind === "seo" ? `fv_head.push_seo_meta(${seoMeta(s, call.arguments[0])});` : `fv_head.push(${headInput(s, call.arguments[0])});`,
    );
    return { before: [], after };
  },
  params: [
    {
      name: "fv_head",
      ty: "&fv::Head",
      pageTy: "&'p fv::Head",
      reads: (c) => runOf(head).has(c),
      test: { lines: ["let head = ferrovue::Head::without_defaults();"], arg: "&head", after: ["head_into(&mut out, &head);"] },
      testSupport: `/// The head, after a marker, as the conformance suite writes unhead's: \`{"headTags":"…",…}\`.
#[cfg(test)]
fn head_into(out: &mut String, head: &ferrovue::Head) {
    let html = head.render();
    if html == ferrovue::HeadHtml::default() {
        return;
    }
    let fields = [
        ("headTags", &html.head_tags),
        ("bodyTags", &html.body_tags),
        ("bodyTagsOpen", &html.body_tags_open),
        ("htmlAttrs", &html.html_attrs),
        ("bodyAttrs", &html.body_attrs),
    ];
    let pairs: Vec<String> = fields
        .iter()
        .map(|(k, v)| format!("{}:{}", serde_json::to_string(k).unwrap(), serde_json::to_string(v).unwrap()))
        .collect();
    out.push_str("<!--fv-head-->{");
    out.push_str(&pairs.join(","));
    out.push('}');
}`,
    },
  ],
};

