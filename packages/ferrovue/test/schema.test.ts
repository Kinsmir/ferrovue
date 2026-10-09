import { parse } from "@babel/parser";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generate, loadConfig } from "../src/compiler.ts";
import { checkConfig } from "../src/context.ts";
import { GenError, type N } from "../src/model.ts";
import { CONFIG_SCHEMA, type Schema } from "../src/schema.ts";

const PACKAGE = join(import.meta.dirname, "..");
const SCHEMA_FILE = join(PACKAGE, "schema.json");
const CONTEXT = readFileSync(join(PACKAGE, "src/context.ts"), "utf8");

type Json = Record<string, unknown>;

function tsdoc(node: N): { text: string; deprecated: string | null } | null {
  const block = (node.leadingComments as N[] | undefined)?.findLast((c: N) => c.type === "CommentBlock" && c.value.startsWith("*"));
  if (!block) return null;
  const lines = (block.value as string).split("\n").map((l) => l.replace(/^\s*\*+\s?/, "").trim()).filter(Boolean);
  const [text, deprecated] = lines.join(" ").trim().split(/\s*@deprecated\s*/);
  return { text: text!, deprecated: deprecated ?? null };
}

function described(source: string, root: string, schema: Schema): { json: Json; problems: string[] } {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  const decls = new Map<string, { type: N; doc: ReturnType<typeof tsdoc> }>();
  for (const st of ast.program.body as N[]) {
    const d = st.type === "ExportNamedDeclaration" ? st.declaration : st;
    const doc = tsdoc(st);
    if (d?.type === "TSInterfaceDeclaration") decls.set(d.id.name, { type: { type: "TSTypeLiteral", members: d.body.body }, doc });
    if (d?.type === "TSTypeAliasDeclaration") decls.set(d.id.name, { type: d.typeAnnotation, doc });
  }
  const problems: string[] = [];
  const resolve = (ts: N): N => {
    if (ts.type === "TSParenthesizedType") return resolve(ts.typeAnnotation);
    if (ts.type === "TSTypeReference" && ts.typeName.name !== "Record") return resolve(decls.get(ts.typeName.name)!.type);
    return ts;
  };
  const walk = (tsType: N, node: Schema, path: string, doc: ReturnType<typeof tsdoc>): Json => {
    const ts = resolve(tsType);
    const out: Json = {};
    const problem = (what: string): void => void problems.push(`${path || "(root)"}: ${what}`);
    if (doc) {
      out.description = doc.text;
      out.markdownDescription = doc.text;
    } else if (path && !path.endsWith("]")) problem("no TSDoc");
    for (const key of ["type", "enum", "default", "minimum"] as const) if (node[key] !== undefined) out[key] = node[key];
    if (Boolean(doc?.deprecated) !== Boolean(node.deprecated)) problem("`@deprecated` in TSDoc and `deprecated` in the schema differ");
    const expectType = (type: Schema["type"]): void => {
      if (node.type !== type) problem(`the schema says ${node.type ?? "no type"}, TypeScript ${type}`);
    };
    switch (ts.type) {
      case "TSStringKeyword":
        expectType("string");
        if (node.enum) problem("an enum of a plain string");
        break;
      case "TSBooleanKeyword":
        expectType("boolean");
        break;
      case "TSNumberKeyword":
        expectType("integer");
        break;
      case "TSArrayType":
        expectType("array");
        out.items = walk(ts.elementType, node.items ?? {}, `${path}[]`, null);
        break;
      case "TSTypeReference": {
        expectType("object");
        const value = ts.typeParameters.params[1];
        out.additionalProperties = walk(value, node.additionalProperties || {}, `${path}[]`, null);
        break;
      }
      case "TSTypeLiteral": {
        expectType("object");
        const members = new Map<string, N>((ts.members as N[]).map((m) => [m.key.type === "StringLiteral" ? m.key.value : m.key.name, m]));
        const props = node.properties ?? {};
        const missing = [...members.keys()].filter((k) => !(k in props));
        const extra = Object.keys(props).filter((k) => !members.has(k));
        if (missing.length) problem(`TypeScript has ${missing.join(", ")}, the schema does not`);
        if (extra.length) problem(`the schema has ${extra.join(", ")}, TypeScript does not`);
        const required = [...members].filter(([, m]) => !m.optional).map(([k]) => k);
        if (JSON.stringify(required.toSorted()) !== JSON.stringify([...(node.required ?? [])].toSorted())) problem(`required ${node.required?.join(", ")}, where TypeScript requires ${required.join(", ")}`);
        out.properties = Object.fromEntries([...members].filter(([k]) => k in props).map(([k, m]) => [k, walk(m.typeAnnotation.typeAnnotation, props[k]!, path ? `${path}.${k}` : k, tsdoc(m))]));
        if (node.required?.length) out.required = node.required;
        if (node.additionalProperties !== false) problem("an object that takes keys TypeScript does not name");
        out.additionalProperties = false;
        break;
      }
      case "TSUnionType": {
        const types = (ts.types as N[]).map(resolve);
        if (types.every((t) => t.type === "TSLiteralType")) {
          expectType("string");
          const values = types.map((t) => t.literal.value as string);
          if (JSON.stringify(values) !== JSON.stringify(node.enum)) problem(`the enum ${JSON.stringify(node.enum)}, where TypeScript has ${JSON.stringify(values)}`);
        } else if (node.oneOf?.length !== types.length) problem("a union that is not a `oneOf` of as many types");
        else out.oneOf = types.map((t, i) => walk(t, node.oneOf![i]!, `${path}[${i}]`, null));
        break;
      }
      default:
        problem(`a TypeScript type the schema cannot say: ${ts.type}`);
    }
    if (node.deprecated) {
      out.deprecated = true;
      out.deprecationMessage = `Deprecated since ${node.deprecated.since}, and goes in the next major release: use ${node.deprecated.use}.`;
    }
    return out;
  };
  const top = decls.get(root)!;
  const body = walk(top.type, schema, "", null);
  return { json: { $schema: "http://json-schema.org/draft-07/schema#", title: "ferrovue.config.json", description: top.doc!.text, ...body }, problems };
}

const schemaText = (): string => `${JSON.stringify(described(CONTEXT, "Config", CONFIG_SCHEMA).json, null, 2)}\n`;

const FULL = {
  $schema: "https://example.com/schema.json",
  components: "components",
  out: "out",
  helpers: { module: "./helpers", functions: { plural: { rust: "crate::plural", params: ["int"], returns: "string", maxLen: 1 } } },
  twins: { VBtn: { rust: "crate::v_btn", props: { label: "string" }, slots: ["default"] } },
  trustedHtml: "ferrovue::InlineHtml",
  routes: "routes.json",
  router: { routes: { pages: "pages" }, base: "/app", linkActiveClass: "on", linkExactActiveClass: "here" },
  stores: "stores",
  clientDirectives: ["focus"],
  i18n: { messages: "locales", locale: "en", fallbackLocale: ["en"] },
  scopeId: "filepath",
  viteRoot: ".",
  builders: false,
};

function schemaPaths(node: Schema, path = ""): string[] {
  const at = (k: string): string => (path ? `${path}.${k}` : k);
  return [
    ...Object.entries(node.properties ?? {}).flatMap(([k, n]) => [at(k), ...schemaPaths(n, at(k))]),
    ...(node.additionalProperties ? [at("*"), ...schemaPaths(node.additionalProperties, at("*"))] : []),
  ];
}

function valuePaths(value: unknown, node: Schema, keys: string[] = [], names: string[] = []): { name: string; keys: string[]; node: Schema }[] {
  if (typeof value !== "object" || value === null || Array.isArray(value) || node.type !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => {
    const named = node.properties?.[k];
    const child = named ?? (node.additionalProperties || null);
    if (!child) return [];
    const path = { keys: [...keys, k], names: [...names, named ? k : "*"] };
    return [{ name: path.names.join("."), keys: path.keys, node: child }, ...valuePaths(v, child, path.keys, path.names)];
  });
}

const withValue = (config: unknown, keys: string[], value: unknown): Json => {
  const copy = structuredClone(config) as Json;
  let at: Json = copy;
  for (const k of keys.slice(0, -1)) at = at[k] as Json;
  if (value === undefined) delete at[keys.at(-1)!];
  else at[keys.at(-1)!] = value;
  return copy;
};

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function project(config: unknown, files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "ferrovue-schema-"));
  roots.push(root);
  writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify(config));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

function refusal(config: unknown): GenError | null {
  try {
    loadConfig(project(config), undefined, () => {});
    return null;
  } catch (e) {
    if (e instanceof GenError) return e;
    throw e;
  }
}

function wrongValues(node: Schema): unknown[] {
  if (node.oneOf) return [true, 1];
  if (node.enum) return ["nope", 1];
  switch (node.type) {
    case "string":
      return [1, null];
    case "boolean":
      return ["yes", 1];
    case "integer":
      return [1.5, "1", ...(node.minimum === undefined ? [] : [node.minimum - 1])];
    case "array":
      return ["x", [1]];
    default:
      return [[], "x"];
  }
}

describe("the configuration's JSON Schema", () => {
  it("names the keys, types, optional keys and descriptions of `Config`", () => {
    expect(described(CONTEXT, "Config", CONFIG_SCHEMA).problems).toEqual([]);
  });

  it("is written to schema.json", () => {
    if (process.env.FERROVUE_SCHEMA_WRITE) writeFileSync(SCHEMA_FILE, schemaText());
    expect(readFileSync(SCHEMA_FILE, "utf8"), "run `pnpm schema:generate`").toBe(schemaText());
  });

  it("is shipped in the package as ferrovue/schema.json", () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as { files: string[]; exports: Record<string, unknown> };
    expect(pkg.files).toContain("schema.json");
    expect(pkg.exports["./schema.json"]).toBe("./schema.json");
  });

  it("is what the compiler accepts: a configuration with every key loads without a warning", () => {
    expect(valuePaths(FULL, CONFIG_SCHEMA).map((p) => p.name).toSorted()).toEqual(schemaPaths(CONFIG_SCHEMA).toSorted());
    const warnings: GenError[] = [];
    expect(() => loadConfig(project(FULL), undefined, (w) => warnings.push(w))).not.toThrow();
    expect(warnings).toEqual([]);
  });

  it("is what the compiler refuses: a value of another type, a missing required key, and a key it does not name", () => {
    const accepted: string[] = [];
    for (const { name, keys, node } of valuePaths(FULL, CONFIG_SCHEMA)) {
      for (const value of wrongValues(node)) if (!refusal(withValue(FULL, keys, value))) accepted.push(`${name} = ${JSON.stringify(value)}`);
    }
    const objects = [{ name: "", keys: [] as string[], node: CONFIG_SCHEMA }, ...valuePaths(FULL, CONFIG_SCHEMA)].filter((p) => p.node.type === "object");
    for (const { name, keys, node } of objects) {
      for (const req of node.required ?? []) if (!refusal(withValue(FULL, [...keys, req], undefined))) accepted.push(`${name} without ${req}`);
      if (node.additionalProperties === false && !refusal(withValue(FULL, [...keys, "zzz"], 1))) accepted.push(`${name}.zzz`);
    }
    for (const value of [{}, { pages: 1 }, { pages: "pages", more: 1 }]) if (!refusal({ ...FULL, routes: value })) accepted.push(`routes = ${JSON.stringify(value)}`);
    expect(accepted).toEqual([]);
  });

  it("gives each default the compiler uses when the key is left out", () => {
    const base = {
      components: "components",
      out: "out",
      router: { routes: "routes.json" },
      i18n: { messages: "locales" },
      helpers: { module: "./helpers", functions: { plural: { rust: "crate::plural", params: ["int"], returns: "string" } } },
    };
    const files = {
      "routes.json": '["/", "/about"]',
      "locales/en.json": '{ "hi": "hello" }',
      "locales/nl.json": '{ "hi": "hallo" }',
      "components/Card.vue": `<script setup lang="ts">
import { plural } from "./helpers";
defineProps<{ n: number; note?: string }>();
</script>
<template><p class="c"><RouterLink to="/about">{{ $t("hi") }}{{ plural(n) }}</RouterLink>{{ note }}</p></template>
<style scoped>.c { color: red }</style>
`,
    };
    const other: Record<string, unknown> = {
      builders: false,
      scopeId: "filepath",
      viteRoot: "sub",
      "router.base": "/app",
      "router.linkActiveClass": "on",
      "router.linkExactActiveClass": "here",
      "i18n.locale": "nl",
      "helpers.functions.*.maxLen": 5,
    };
    const defaults = valuePaths(FULL, CONFIG_SCHEMA).filter((p) => p.node.default !== undefined);
    expect(defaults.map((p) => p.name).toSorted()).toEqual(Object.keys(other).toSorted());
    const out = (config: unknown): string => JSON.stringify([...generate(project(config, files), config as Parameters<typeof generate>[1])]);
    const unset = out(base);
    for (const { name, keys, node } of defaults) {
      expect(out(withValue(base, keys, node.default)), `${name}: ${JSON.stringify(node.default)}`).toBe(unset);
      expect(out(withValue(base, keys, other[name])), `${name}: ${JSON.stringify(other[name])}`).not.toBe(unset);
    }
  });

  it("has every top-level key in the README's and the quick start's tables", () => {
    const keys = Object.keys(CONFIG_SCHEMA.properties!).filter((k) => k !== "$schema");
    for (const doc of ["../../README.md", "../../crates/ferrovue/docs/guide/quick_start.md"]) {
      const text = readFileSync(join(PACKAGE, doc), "utf8");
      const table = text.slice(text.indexOf("| Key | Required | Meaning |"));
      const rows = [...table.slice(0, table.indexOf("\n\n")).matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]!);
      expect(rows.toSorted(), doc).toEqual(keys.toSorted());
    }
  });

  it("takes `$schema`, which changes nothing", () => {
    const files = { "components/Hello.vue": "<template><p>hi</p></template>" };
    const plain = { components: "components", out: "out" };
    const root = project({ ...plain, $schema: "https://example.com/schema.json" }, files);
    expect(generate(root, loadConfig(root))).toEqual(generate(project(plain, files)));
  });
});

describe("a deprecated configuration key", () => {
  const schema: Schema = {
    type: "object",
    properties: {
      components: { type: "string" },
      out: { type: "string" },
      pages: { type: "string" },
      folder: { type: "string", deprecated: { since: "0.7.0", use: "`pages`" } },
      nested: { type: "object", properties: { old: { type: "string", deprecated: { since: "0.8.0", use: "`nested.new`" } }, new: { type: "string" } }, additionalProperties: false },
    },
    required: ["components", "out"],
    additionalProperties: false,
  };
  const warnings = (raw: unknown): GenError[] => {
    const found: GenError[] = [];
    checkConfig(raw, "ferrovue.config.json", (w) => found.push(w), schema);
    return found;
  };

  it("is read, with a warning naming what replaces it", () => {
    const [top, ...rest] = warnings({ components: "c", out: "o", folder: "pages" });
    expect(rest).toEqual([]);
    expect(top).toMatchObject({ code: "FV1117", at: { file: "ferrovue.config.json" } });
    expect(top!.message).toBe("`folder` in ferrovue.config.json is deprecated since 0.7.0, and goes in the next major release: use `pages`");
    expect(warnings({ components: "c", out: "o", nested: { old: "x" } }).map((w) => w.message)).toEqual([
      "`nested.old` in ferrovue.config.json is deprecated since 0.8.0, and goes in the next major release: use `nested.new`",
    ]);
    expect(warnings({ components: "c", out: "o", pages: "p" })).toEqual([]);
  });

  it("is not what a misspelt key is taken to mean", () => {
    expect(() => warnings({ components: "c", out: "o", foldr: "x" })).toThrow(/has no key `foldr`: it takes `components`, `out`, `pages`, `nested`$/);
  });

  it("is marked in the JSON Schema as deprecated, with the message an editor shows", () => {
    const source = `/** A configuration. */
interface Config {
  /** Components. */
  components: string;
  /** Output. */
  out: string;
  /** Pages. */
  pages?: string;
  /** Pages, by their old name.
   * @deprecated Use \`pages\`. */
  folder?: string;
  /** Nested. */
  nested?: {
    /** Old. @deprecated Use \`nested.new\`. */
    old?: string;
    /** New. */
    new?: string;
  };
}`;
    const { json, problems } = described(source, "Config", schema);
    expect(problems).toEqual([]);
    const props = json.properties as Record<string, Json>;
    expect(props.folder).toMatchObject({ description: "Pages, by their old name.", deprecated: true, deprecationMessage: "Deprecated since 0.7.0, and goes in the next major release: use `pages`." });
    expect(props.pages).not.toHaveProperty("deprecated");
    expect(described(source.replace("@deprecated Use `pages`.", ""), "Config", schema).problems).toEqual(["folder: `@deprecated` in TSDoc and `deprecated` in the schema differ"]);
  });
});
