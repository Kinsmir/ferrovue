/* vue-i18n: the locale files read and compiled to Rust tables, and `$t` / `useI18n().t` calls. */

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createParser } from "@intlify/message-compiler";
import { type N, type Scope, type Val, fail, GenError, rustStr, STR } from "./model.ts";
import { ctx } from "./context.ts";
import { expr } from "./expr.ts";
import { bare, strArg } from "./parens.ts";
import { header } from "./rust.ts";

/** A locale's messages, each parsed by vue-i18n's own message compiler, by dotted key. */
export interface LocaleMessages {
  name: string;
  file: string;
  messages: Map<string, N>;
}

/** The configured vue-i18n setup, read once per run. */
export interface I18nSetup {
  /** The locale files' directory, as the configuration names it. */
  dir: string;
  locales: LocaleMessages[];
  /** The locale a fixture renders in when it names none, and the fallbacks in order. */
  locale: string;
  fallback: string[];
}

/** The modifiers vue-i18n defines for linked messages; any other would throw in the browser. */
const MODIFIERS = new Set(["upper", "lower", "capitalize"]);

/** Every message of every `*.json` locale file in the directory: nested objects joined with dots,
 * as vue-i18n resolves a path — a nested key first, then a flat key of the same spelling. */
export function readLocales(root: string, config: { messages: string; locale?: string; fallbackLocale?: string | string[] }): I18nSetup {
  const dir = join(root, config.messages);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).toSorted();
  const parser = createParser({});
  const locales = files.map((f): LocaleMessages => {
    const file = join(config.messages, f);
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch (e) {
      throw new GenError(`${file}: ${(e as Error).message}`);
    }
    const messages = new Map<string, N>();
    const nested = new Map<string, string>();
    const flat = new Map<string, string>();
    const walk = (value: unknown, path: string[]): void => {
      if (typeof value === "string") {
        const key = path.join(".");
        // A key spelled with dots is reached only when no nested path is.
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
        throw new GenError(`${file}: message \`${key}\`: ${(e as Error).message}`);
      }
    }
    return { name: basename(f, ".json"), file, messages };
  });
  const fallback = config.fallbackLocale === undefined ? [] : Array.isArray(config.fallbackLocale) ? config.fallbackLocale : [config.fallbackLocale];
  return { dir: config.messages, locales, locale: config.locale ?? "en", fallback };
}

/** A message's AST as the Rust `Message` literal: its cases, each a list of `Part`s. */
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
        if (item.key?.type !== 7) throw new GenError(`${file}: message \`${key}\` links to a key chosen at run time, which is not supported`);
        const modifier = item.modifier?.value;
        if (modifier !== undefined && !MODIFIERS.has(modifier)) {
          throw new GenError(`${file}: message \`${key}\` uses the modifier \`${modifier}\`, which vue-i18n does not define`);
        }
        return `Part::Linked { key: ${rustStr(item.key.value)}, modifier: ${modifier === undefined ? "None" : `Some(${rustStr(modifier)})`} }`;
      }
      default:
        throw new GenError(`${file}: message \`${key}\` holds a construct ferrovue does not render (node type ${item.type})`);
    }
  };
  const items = (c: N): N[] => c.items ?? (c.static !== undefined ? [{ type: 3, value: c.static }] : []);
  return `Message { cases: &[${cases.map((c) => `&[${items(c).map(part).join(", ")}]`).join(", ")}] }`;
}

/** Keys in the order Rust's `str` sorts them — byte order — for the table's binary search. */
function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

export function i18nSource(setup: I18nSetup): string {
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

/** A value interpolated into a message, as \`ferrovue::i18n::Value\`. */
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
      return fail(s.comp, "a value given to `t()` is a string, a number or a boolean that is present: narrow an optional one with `v-if` first", n);
  }
}

/** `t(key)`, `t(key, plural)`, `t(key, { named })`, `t(key, [list])`, `t(key, { named }, plural)`:
 * the message translated in the request's locale. */
export function translate(s: Scope, args: N[], n: N): Val {
  if (!ctx.i18n) fail(s.comp, "`t()` needs `i18n` in ferrovue.config.json: where the locale files are", n);
  if (args.length < 1 || args.length > 3) fail(s.comp, "`t()` takes a key, then named values, a list or a plural number", n);
  const key = expr(s, args[0]);
  if (key.ty.k !== "str") fail(s.comp, "the key given to `t()` is a string", args[0]);
  let named = "&[]";
  let list = "&[]";
  let plural = "None";
  for (const a of args.slice(1)) {
    if (a.type === "ObjectExpression") {
      const pairs = a.properties.map((p: N) => {
        if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "named values hold plain keys", p);
        return `(${rustStr(String(p.key.name ?? p.key.value))}, ${i18nValue(s, p.value)})`;
      });
      named = `&[${pairs.join(", ")}]`;
    } else if (a.type === "ArrayExpression") {
      list = `&[${a.elements.map((el: N) => i18nValue(s, el)).join(", ")}]`;
    } else {
      const v = expr(s, a);
      if (v.ty.k === "str") fail(s.comp, "a default message given to `t()` is not supported: add the message to the locale files", a);
      if (v.ty.k !== "int") fail(s.comp, "the plural number given to `t()` is an integer", a);
      plural = `Some(${bare(v.code)})`;
    }
  }
  return { code: `&*fv_i18n.t(${strArg(key.code)}, &fv::i18n::Args { named: ${named}, list: ${list}, plural: ${plural} })`, ty: STR };
}
