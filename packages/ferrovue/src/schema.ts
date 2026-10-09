/** A key or option that still works and goes in the next major release. */
export interface Deprecation {
  /** The version that deprecated it. */
  since: string;
  /** What to write instead, as the warning names it: `` `router.routes` ``. */
  use: string;
}

/** The part of JSON Schema (draft-07) that describes `ferrovue.config.json`, with `deprecated` naming
 * what replaces a key. Descriptions come from the TSDoc of `Config` when `schema.json` is written. */
export interface Schema {
  type?: "string" | "boolean" | "integer" | "object" | "array";
  enum?: readonly string[];
  default?: unknown;
  minimum?: number;
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: readonly string[];
  additionalProperties?: false | Schema;
  oneOf?: readonly Schema[];
  deprecated?: Deprecation;
}

const STRING: Schema = { type: "string" };
/** The types a helper or twin takes, as the configuration spells them. */
export const TYPE_NAMES: readonly string[] = ["string", "string?", "int", "int?", "float", "float?", "bool"];

const TYPE_NAME: Schema = { type: "string", enum: TYPE_NAMES };
const ROUTES: Schema = { oneOf: [STRING, { type: "object", properties: { pages: STRING }, required: ["pages"], additionalProperties: false }] };

/** What `ferrovue.config.json` may hold: the keys the compiler reads, their types and defaults. */
export const CONFIG_SCHEMA: Schema = {
  type: "object",
  properties: {
    $schema: STRING,
    components: STRING,
    out: STRING,
    helpers: {
      type: "object",
      properties: {
        module: STRING,
        functions: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: { rust: STRING, params: { type: "array", items: TYPE_NAME }, returns: TYPE_NAME, maxLen: { type: "integer", minimum: 0, default: 0 } },
            required: ["rust", "params", "returns"],
            additionalProperties: false,
          },
        },
      },
      required: ["module", "functions"],
      additionalProperties: false,
    },
    twins: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: { rust: STRING, props: { type: "object", additionalProperties: TYPE_NAME }, slots: { type: "array", items: STRING } },
        required: ["rust"],
        additionalProperties: false,
      },
    },
    trustedHtml: STRING,
    routes: ROUTES,
    router: {
      type: "object",
      properties: {
        routes: ROUTES,
        base: { type: "string", default: "" },
        linkActiveClass: { type: "string", default: "router-link-active" },
        linkExactActiveClass: { type: "string", default: "router-link-exact-active" },
      },
      required: ["routes"],
      additionalProperties: false,
    },
    stores: STRING,
    clientDirectives: { type: "array", items: STRING },
    i18n: {
      type: "object",
      properties: { messages: STRING, locale: { type: "string", default: "en" }, fallbackLocale: { oneOf: [STRING, { type: "array", items: STRING }] } },
      required: ["messages"],
      additionalProperties: false,
    },
    scopeId: { type: "string", enum: ["filepath", "filepath-source"], default: "filepath-source" },
    viteRoot: { type: "string", default: "." },
    builders: { type: "boolean", default: true },
  },
  required: ["components", "out"],
  additionalProperties: false,
};
