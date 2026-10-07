import { basename, posix } from "node:path";
import { createParser } from "@intlify/message-compiler";
import { type Component, type N, type Scope, type Val, fail, failIn, rustStr, STR } from "../model.ts";
import { expr } from "../expr.ts";
import { bare, strArg } from "../parens.ts";
import { header } from "../rust.ts";
import { listDir, readJsonFile } from "../files.ts";
import { type Plugin, runOf, scopeOf } from "../plugin.ts";

export interface LocaleMessages {
  name: string;
  file: string;
  messages: Map<string, N>;
}

export interface I18nSetup {
  dir: string;
  locales: LocaleMessages[];
  locale: string;
  fallback: string[];
}

interface I18nRun {
  setup: I18nSetup | null;
  readers: Set<Component>;
}

interface I18nScope {
  useI18n: string | null;
  t: Set<string>;
}

const MODIFIERS = new Set(["upper", "lower", "capitalize"]);

function readLocales(root: string, config: { messages: string; locale?: string; fallbackLocale?: string | string[] }): I18nSetup {
  const files = listDir(root, config.messages, "i18n.messages").filter((f) => f.endsWith(".json")).toSorted();
  const parser = createParser({});
  const locales = files.map((f): LocaleMessages => {
    const file = posix.join(config.messages, f);
    const data = readJsonFile(root, file, { invalid: "FV1401" });
    const messages = new Map<string, N>();
    const nested = new Map<string, string>();
    const flat = new Map<string, string>();
    const walk = (value: unknown, path: string[]): void => {
      if (typeof value === "string") {
        const key = path.join(".");
        (path.length > 1 ? nested : flat).set(key, value);
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [k, v] of Object.entries(value)) walk(v, [...path, k]);
      }
    };
    walk(data, []);
    for (const [key, text] of [...flat, ...nested]) {
      try {
        messages.set(key, parser.parse(text));
      } catch (e) {
        failIn(file, "FV1402", `message \`${key}\`: ${(e as Error).message}`);
      }
    }
    return { name: basename(f, ".json"), file, messages };
  });
  const fallback = config.fallbackLocale === undefined ? [] : Array.isArray(config.fallbackLocale) ? config.fallbackLocale : [config.fallbackLocale];
  return { dir: config.messages, locales, locale: config.locale ?? "en", fallback };
}

function messageSource(file: string, key: string, ast: N): string {
  const body = ast.body;
  const cases: N[] = body.type === 1 ? body.cases : [body];
  const part = (item: N): string => {
    switch (item.type) {
      case 3:
        return `Part::Text(${rustStr(item.value)})`;
      case 4:
        return `Part::Named(${rustStr(item.key)})`;
      case 5:
        return `Part::List(${item.index})`;
      case 9:
        return `Part::Literal(${rustStr(item.value)})`;
      case 6: {
        if (item.key?.type !== 7) failIn(file, "FV1403", `message \`${key}\` links to a key chosen at run time, which is not supported`);
        const modifier = item.modifier?.value;
        if (modifier !== undefined && !MODIFIERS.has(modifier)) {
          failIn(file, "FV1404", `message \`${key}\` uses the modifier \`${modifier}\`, which vue-i18n does not define`);
        }
        return `Part::Linked { key: ${rustStr(item.key.value)}, modifier: ${modifier === undefined ? "None" : `Some(${rustStr(modifier)})`} }`;
      }
      default:
        return failIn(file, "FV1405", `message \`${key}\` holds a construct ferrovue does not render (node type ${item.type})`);
    }
  };
  const items = (c: N): N[] => c.items ?? (c.static !== undefined ? [{ type: 3, value: c.static }] : []);
  return `Message { cases: &[${cases.map((c) => `&[${items(c).map(part).join(", ")}]`).join(", ")}] }`;
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

function i18nSource(setup: I18nSetup): string {
  const locales = setup.locales
    .map((l) => {
      const keys = [...l.messages.keys()].toSorted(byteOrder);
      const entries = keys.map((k) => `            (${rustStr(k)}, ${messageSource(l.file, k, l.messages.get(k))}),`).join("\n");
      return `    Locale {
        name: ${rustStr(l.name)},
        messages: &[
${entries}
        ],
    },`;
    })
    .join("\n");
  return `${header(setup.dir.replace(/\/?$/, "/"), "the locale files")}
//! The messages of every locale, compiled by vue-i18n's own message compiler.

use ferrovue::i18n::{Locale, Message, Part};

/// The locale a page renders in when it names none.
pub const LOCALE: &str = ${rustStr(setup.locale)};

/// The locales a missing message falls back to, in order.
pub const FALLBACK: &[&str] = &[${setup.fallback.map(rustStr).join(", ")}];

/// Every locale's messages.
pub static LOCALES: &[Locale] = &[
${locales}
];

/// The messages in \`locale\`, with the configured fallbacks: build one per request.
pub fn i18n(locale: &str) -> ferrovue::I18n {
    ferrovue::I18n::new(LOCALES, locale, FALLBACK)
}
`;
}

function i18nValue(s: Scope, n: N): string {
  const v = expr(s, n);
  switch (v.ty.k) {
    case "str":
      return `fv::i18n::Value::Str(${strArg(v.code)})`;
    case "int":
      return `fv::i18n::Value::Int(${bare(v.code)})`;
    case "float":
      return `fv::i18n::Value::Float(${bare(v.code)})`;
    case "bool":
      return `fv::i18n::Value::Bool(${bare(v.code)})`;
    default:
      return fail(s.comp, "FV1406", "a value given to `t()` is a string, a number or a boolean that is present: narrow an optional one with `v-if` first", n);
  }
}

function translate(s: Scope, args: N[], n: N): Val {
  if (!runOf(i18n).setup) fail(s.comp, "FV1407", "`t()` needs `i18n` in ferrovue.config.json: where the locale files are", n);
  if (args.length < 1 || args.length > 3) fail(s.comp, "FV1408", "`t()` takes a key, then named values, a list or a plural number", n);
  const key = expr(s, args[0]);
  if (key.ty.k !== "str") fail(s.comp, "FV1409", "the key given to `t()` is a string", args[0]);
  let named = "&[]";
  let list = "&[]";
  let plural = "None";
  for (const a of args.slice(1)) {
    if (a.type === "ObjectExpression") {
      const pairs = a.properties.map((p: N) => {
        if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "FV1410", "named values hold plain keys", p);
        return `(${rustStr(String(p.key.name ?? p.key.value))}, ${i18nValue(s, p.value)})`;
      });
      named = `&[${pairs.join(", ")}]`;
    } else if (a.type === "ArrayExpression") {
      list = `&[${a.elements.map((el: N) => i18nValue(s, el)).join(", ")}]`;
    } else {
      const v = expr(s, a);
      if (v.ty.k === "str") fail(s.comp, "FV1411", "a default message given to `t()` is not supported: add the message to the locale files", a);
      if (v.ty.k !== "int") fail(s.comp, "FV1412", "the plural number given to `t()` is an integer", a);
      plural = `Some(${bare(v.code)})`;
    }
  }
  return { code: `&*fv_i18n.t(${strArg(key.code)}, &fv::i18n::Args { named: ${named}, list: ${list}, plural: ${plural} })`, ty: STR };
}

export const i18n: Plugin<I18nRun, I18nScope> = {
  name: "i18n",
  configure: (config, root) => ({ setup: config.i18n ? readLocales(root, config.i18n) : null, readers: new Set() }),
  compiled(comp, code) {
    if (code.includes("_ctx.$t(")) runOf(i18n).readers.add(comp);
  },
  scope: () => ({ useI18n: null, t: new Set() }),
  scriptImport(s, st, from) {
    if (from !== "vue-i18n") return false;
    for (const sp of st.specifiers) {
      const name = sp.type === "ImportSpecifier" ? (sp.imported.name ?? sp.imported.value) : null;
      if (name === "useI18n") scopeOf(i18n, s).useI18n = sp.local.name;
      else s.clientOnly.set(sp.local.name, `\`${name}\` from vue-i18n does not run on the server`);
    }
    return true;
  },
  scriptBinding(s, d) {
    const own = scopeOf(i18n, s);
    const init = d.init;
    if (own.useI18n === null || d.id.type !== "ObjectPattern" || init?.type !== "CallExpression" || init.callee.type !== "Identifier" || init.callee.name !== own.useI18n) {
      return false;
    }
    for (const p of d.id.properties) {
      if (p.type !== "ObjectProperty" || p.computed || p.value.type !== "Identifier") {
        fail(s.comp, "FV1413", "`useI18n()` is destructured into plain names", p);
      }
      const key: string = p.key.name ?? p.key.value;
      if (key === "t") own.t.add(p.value.name);
      else if (key === "locale") {
        s.setup.set(p.value.name, { code: "fv_i18n.locale()", ty: STR });
        s.refs.add(p.value.name);
      } else s.clientOnly.set(p.value.name, `\`${key}\` from \`useI18n()\` does not run on the server`);
    }
    runOf(i18n).readers.add(s.comp);
    return true;
  },
  call(s, n) {
    const callee = n.callee;
    const { t } = scopeOf(i18n, s);
    const translates =
      callee.type === "Identifier"
        ? t.has(callee.name)
        : callee.object.type === "Identifier" &&
          ((callee.object.name === "_ctx" && callee.property.name === "$t") || (callee.object.name === "$setup" && t.has(callee.property.name)));
    return translates ? translate(s, n.arguments, n) : null;
  },
  params: [
    {
      name: "fv_i18n",
      ty: "&fv::I18n",
      pageTy: "&'p fv::I18n",
      reads: (c) => runOf(i18n).readers.has(c),
      test: { lines: ["let i18n = i18n::i18n(fixture.locale.as_deref().unwrap_or(i18n::LOCALE));"], arg: "&i18n", fixture: true },
      fixtureField: '    #[serde(rename = "$locale", default)]\n    locale: Option<String>,',
    },
  ],
  modules() {
    const { setup } = runOf(i18n);
    return setup ? [["i18n.rs", i18nSource(setup)]] : [];
  },
};
