import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileTemplate, parse as parseSfc } from "@vue/compiler-sfc";
import { loadConfig } from "../src/config.ts";
import { GenError } from "../src/errors.ts";
import { generate } from "../src/compiler.ts";
import type { ErrorCode } from "../src/errors.ts";
import { CONFIG, compile, island, roots } from "./project.ts";

describe("imports through aliases", () => {
  const component = (from: string) => `<script setup lang="ts">
import { LABEL } from "${from}";
import type { Row } from "${from}";
defineProps<{ row: Row }>();
</script>
<template><p>{{ LABEL }} {{ row.name }}</p></template>`;
  const lib = 'export const LABEL = "Label";\nexport interface Row { name: string }\n';
  const project = (files: Record<string, string>): string => {
    const made = mkdtempSync(join(tmpdir(), "ferrovue-"));
    roots.push(made);
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(join(made, file, ".."), { recursive: true });
      writeFileSync(join(made, file), text);
    }
    return made;
  };
  const SRC = { components: "src/components", out: "out" };
  /** Whether the component read both the constant and the type through the import. */
  const resolves = (root: string, options: Parameters<typeof generate>[3] = {}): boolean => {
    const out = generate(root, SRC, new Map(), options);
    return out.get("x.rs")!.includes('out.push_str("<p>Label ");') && out.get("types.rs")!.includes("pub struct Row");
  };

  it("resolves the `paths` of the tsconfig.json nearest the component, written with comments and trailing commas", () => {
    const tsconfig = `{
  // as create-vue writes it
  "compilerOptions": {
    "paths": { "@/*": ["./src/*",], /* the root */ "~/*": ["./*"] },
  },
}
`;
    expect(resolves(project({ "tsconfig.json": tsconfig, "src/lib/format.ts": lib, "src/components/X.vue": component("@/lib/format") }))).toBe(true);
    expect(resolves(project({ "tsconfig.json": tsconfig, "src/lib/format/index.ts": lib, "src/components/X.vue": component("~/src/lib/format") }))).toBe(true);
  });

  it("resolves `paths` against `baseUrl`, and a bare path against `baseUrl` alone", () => {
    const tsconfig = JSON.stringify({ compilerOptions: { baseUrl: "src", paths: { "#lib/*": ["lib/*"] } } });
    expect(resolves(project({ "tsconfig.json": tsconfig, "src/lib/format.ts": lib, "src/components/X.vue": component("#lib/format") }))).toBe(true);
    expect(resolves(project({ "tsconfig.json": tsconfig, "src/lib/format.ts": lib, "src/components/X.vue": component("lib/format") }))).toBe(true);
  });

  it("takes the pattern with the longest prefix, and an exact one first", () => {
    const tsconfig = JSON.stringify({ compilerOptions: { paths: { "@/*": ["./wrong/*"], "@/lib/*": ["./src/lib/*"], "@/format": ["./src/lib/format.ts"] } } });
    expect(resolves(project({ "tsconfig.json": tsconfig, "src/lib/format.ts": lib, "src/components/X.vue": component("@/lib/format") }))).toBe(true);
    expect(resolves(project({ "tsconfig.json": tsconfig, "src/lib/format.ts": lib, "src/components/X.vue": component("@/format") }))).toBe(true);
  });

  it("follows `extends`, relative to the file that declares `paths`, as Nuxt's generated tsconfig.json is", () => {
    expect(resolves(
      project({
        "tsconfig.json": JSON.stringify({ extends: "./.nuxt/tsconfig.json" }),
        ".nuxt/tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "~/*": ["../*"], "@/*": ["../*"] } } }),
        "lib/format.ts": lib,
        "src/components/X.vue": component("@/lib/format"),
      }),
    )).toBe(true);
  });

  it("follows the projects a solution-style tsconfig.json references, as create-vue's is", () => {
    expect(resolves(
      project({
        "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.node.json" }, { path: "./tsconfig.app.json" }] }),
        "tsconfig.node.json": JSON.stringify({ compilerOptions: { types: ["node"] } }),
        "tsconfig.app.json": JSON.stringify({ extends: ["./tsconfig.base.json"], include: ["src/**/*"] }),
        "tsconfig.base.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
        "src/lib/format.ts": lib,
        "src/components/X.vue": component("@/lib/format"),
      }),
    )).toBe(true);
  });

  it("tries the aliases it is given first, as Vite's `resolve.alias` lists them", () => {
    const root = project({ "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./wrong/*"] } } }), "src/lib/format.ts": lib, "src/components/X.vue": component("@/lib/format") });
    expect(resolves(root, { aliases: [{ find: "@", replacement: join(root, "src") }] })).toBe(true);
    expect(resolves(root, { aliases: [{ find: /^@\/(.*)$/, replacement: join(root, "src", "$1") }] })).toBe(true);
    expect(resolves(root, { aliases: [{ find: "@", replacement: "../" }] })).toBe(true);
  });

  it("refuses a name imported from a module it cannot resolve, naming the specifier and where it looked", () => {
    const refused = (files: Record<string, string>, from: string, options: Parameters<typeof generate>[3] = {}): string => {
      try {
        generate(project({ ...files, "src/components/X.vue": component(from) }), SRC, new Map(), options);
      } catch (e) {
        if (!(e instanceof GenError)) throw e;
        return `${e.code}: ${e.message.split("\n")[0]!}`;
      }
      throw new Error("compiled without an error");
    };
    const paths = { "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }) };
    expect(refused(paths, "@/lib/missing")).toBe(
      "FV0110: src/components/X.vue:4:20: `Row` is imported from `@/lib/missing`, which the compiler cannot resolve to a `.ts` file of the project: `@/*` in tsconfig.json's `paths` maps it to src/lib/missing, where there is no `.ts` file",
    );
    expect(refused(paths, "date-fns")).toMatch(
      /^FV0110: .*`Row` is imported from `date-fns`, which .*: it is a package, or an alias declared neither in the `compilerOptions.paths` of tsconfig.json nor in Vite's `resolve.alias` \(read only by the Vite plugin\)$/,
    );
    expect(refused({}, "@/lib/format")).toMatch(/^FV0110: .*it is a package, or an alias declared neither in a tsconfig.json's `compilerOptions.paths` \(there is none\) nor in Vite's `resolve.alias` \(read only by the Vite plugin\)$/);
    expect(refused({ "tsconfig.json": "{ not json" }, "@/lib/format")).toMatch(/^FV0110: .*the `compilerOptions.paths` of tsconfig.json \(tsconfig.json is not valid JSON: .*\) nor/);
    expect(refused({}, "./nope")).toMatch(/^FV0110: .*`Row` is imported from `\.\/nope`, which .*: there is no `\.ts` file at src\/components\/nope$/);
    expect(refused({}, "~/lib/format", { aliases: [{ find: "~", replacement: "some-package" }] })).toMatch(/^FV0110: .*: Vite's alias `~` maps it to a package$/);
  });

  it("refuses a value imported from a package where the server reads it, and leaves one the client alone uses", () => {
    const root = project({
      "src/components/X.vue": `<script setup lang="ts">
import { format } from "date-fns";
import { useQuery } from "@tanstack/vue-query";
</script>
<template><p @click="useQuery">{{ format(1) }}</p></template>`,
    });
    expect(() => generate(root, SRC)).toThrow(/^src\/components\/X\.vue:5:\d+: `format` is imported from `date-fns`, which the compiler cannot resolve/);
    writeFileSync(join(root, "src", "components", "X.vue"), readFileSync(join(root, "src", "components", "X.vue"), "utf8").replace("{{ format(1) }}", "x"));
    expect(generate(root, SRC).get("x.rs")).toContain('out.push_str("<p>x</p>");');
  });
});

describe("`v-bind()` in `<style>`", () => {
  const source = `<script setup lang="ts">
const props = defineProps<{ color: string; gap?: number }>();
</script>
<template><p>x</p></template>
<style>
p { color: v-bind(color); gap: v-bind(gap); width: v-bind('color + "px"'); }
</style>`;
  const vueNames = (id: string, isProd: boolean): string[] => {
    const { descriptor } = parseSfc(source, { filename: "X.vue" });
    const { code } = compileTemplate({ source: descriptor.template!.content, filename: "X.vue", id: `data-v-${id}`, ssr: true, ssrCssVars: descriptor.cssVars, isProd });
    return [...code.matchAll(/^\s*"(:--(?:[^"\\]|\\.)*)":/gm)].map((m) => JSON.parse(`"${m[1]!.slice(1)}"`) as string);
  };
  const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 8);

  it("names the variables as Vue's compiler does, for production by default and for development", () => {
    const root = island(source);
    const production = vueNames(hash(`components/X.vue${source}`), true);
    const development = vueNames(hash("components/X.vue"), false);
    expect(production).toHaveLength(3);
    expect(production.filter((n) => n.includes("color") || n.includes("gap"))).toEqual([]);
    expect(development[2]).toBe(`--${hash("components/X.vue")}-color\\ \\+\\ \\"px\\"`);
    const written = (config: object) => generate(root, { ...CONFIG, ...config }).get("x.rs")!;
    const literal = (name: string): string => `${name.replaceAll('"', "&quot;").replaceAll("\\", "\\\\")}:`;
    for (const name of production) expect(written({})).toContain(literal(name));
    for (const name of development) expect(written({ scopeId: "filepath", isProduction: false })).toContain(literal(name));
    expect(written({})).not.toContain(literal(development[0]!));
  });

  it("writes `initial` for an absent value and a space for an empty string, as `ssrRenderStyle` does", () => {
    const out = generate(island(source), { ...CONFIG, scopeId: "filepath", isProduction: false }).get("x.rs")!;
    expect(out).toContain(`;--7db74d24-gap:initial;`);
    expect(out).toContain("out.push(' ');");
  });
});

describe("HTML comments in a template", () => {
  const child = `<script setup lang="ts">
defineProps<{ label: string }>();
</script>
<template>
  <!-- the box -->
  <div class="box"><!-- inside --><slot><!-- empty -->{{ label }}</slot></div>
</template>`;
  const parent = `<script setup lang="ts">
import Box from "./Box.vue";
defineProps<{ label: string; on: boolean }>();
</script>
<template>
  <section><!-- before --><Box class="outer" :label="label"><!-- slotted --><b>{{ label }}</b></Box>
    <i v-if="on">yes</i>
    <!-- between branches -->
    <i v-else>no</i>
  </section>
</template>`;
  const uncommented = (text: string): string => text.replace(/<!--[^]*?-->/g, (c) => " ".repeat(c.length));
  const written = (config: object, strip = false) => {
    const files = generate(island(strip ? uncommented(parent) : parent, { Box: strip ? uncommented(child) : child }), { ...CONFIG, ...config });
    return { x: files.get("x.rs")!, box: files.get("box.rs")! };
  };

  it("leaves them out by default, as Vue's production build, so a root beside a comment takes a parent's attributes", () => {
    const out = written({});
    expect(out).toEqual(written({}, true));
    expect(`${out.x}${out.box}`).not.toMatch(/<!-- |-->"/);
    expect(out.box).toContain("fv_attrs.list()");
  });

  it("keeps them with `comments` or `isProduction: false`, as Vue's development build, a comment beside the root making a fragment", () => {
    const out = written({ comments: true });
    for (const text of ["<!-- the box -->", "<!-- inside -->", "<!-- before -->", "<!-- slotted -->", "<!-- between branches -->"]) expect(`${out.x}${out.box}`).toContain(text);
    expect(out.box).toContain("<!--[-->");
    expect(written({ isProduction: false })).toEqual(out);
    expect(written({ isProduction: false, comments: false })).toEqual(written({}));
  });
});

describe("`<style module>`", () => {
  const MODULES = { ...CONFIG, cssModules: { generateScopedName: "[local]_x" } };
  const refusalWith = (source: string): GenError => {
    try {
      generate(island(source), MODULES);
    } catch (e) {
      if (e instanceof GenError) return e;
      throw e;
    }
    throw new Error("compiled without an error");
  };

  it.each([
    ["a module in another file", `<template><i /></template>\n<style module src="./x.css"></style>`, "FV1014", /^components\/X\.vue:2:1: `<style module src>`/],
    ["a module a preprocessor compiles", `<template><i /></template>\n<style module lang="scss">.a { .b { color: red } }</style>`, "FV1014", /^components\/X\.vue:2:1: `<style module lang="scss">`/],
    ["a class composed from another file", `<template><i /></template>\n<style module>.a { composes: b from "./b.css"; }</style>`, "FV1014", /cannot name: it imports from another file/],
    ["a value imported from another file", `<template><i /></template>\n<style module>@value b from "./b.css";\n.a { color: b; }</style>`, "FV1014", /cannot name: it imports from another file/],
    ["CSS that does not parse", `<template><i /></template>\n<style module>.a { color: red</style>`, "FV1014", /cannot name: .*Unclosed block/],
    [
      "`useCssModule` of a module the component lacks",
      `<script setup lang="ts">\nimport { useCssModule } from "vue";\nconst c = useCssModule("nope");\n</script>\n<template><i :class="c.a" /></template>\n<style module>.a { color: red }</style>`,
      "FV1015",
      /^components\/X\.vue:3:11: `useCssModule\("nope"\)` names no `<style module="nope">` of this component/,
    ],
    [
      "`useCssModule` of a name chosen at run time",
      `<script setup lang="ts">\nimport { useCssModule } from "vue";\nconst props = defineProps<{ n: string }>();\nconst c = useCssModule(props.n);\n</script>\n<template><i :class="c.a" /></template>\n<style module>.a { color: red }</style>`,
      "FV1015",
      /takes the name of a `<style module>` as a string literal/,
    ],
  ])("refuses %s", (_, source, code, message) => {
    const e = refusalWith(source);
    expect(e.code).toBe(code);
    expect(e.message).toMatch(message);
  });

  it("reads a module's classes as constant strings, and a class it lacks as `undefined`", () => {
    const out = generate(
      island(`<script setup lang="ts">
import { useCssModule } from "vue";
const theme = useCssModule("theme");
</script>
<template><p :class="[$style.a, $style.missing, theme.b]" :title="$style.missing">{{ $style['a-b'] }}</p></template>
<style module>.a { color: red } .a-b { color: blue }</style>
<style module="theme">.b { color: red }</style>`),
      MODULES,
    ).get("x.rs")!;
    expect(out).toContain('out.push_str("<p class=\\"a_x b_x\\">a-b_x</p>");');
  });

  it("refuses a module bound whole", () => {
    const e = refusalWith(`<template><i :title="$style" /></template>\n<style module>.a { color: red }</style>`);
    expect(e.message).toMatch(/`title` is bound to the CSS module `\$style`.*bind one of its classes, as `\$style\.name`/);
  });
});

describe("the configuration", () => {
  const configured = (config: unknown): string => {
    const root = island(`<template><p /></template>`);
    writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify(config));
    return root;
  };
  const refusedWith = (config: unknown): GenError => {
    try {
      loadConfig(configured(config));
    } catch (e) {
      if (e instanceof GenError) return e;
      throw e;
    }
    throw new Error("loaded without an error");
  };
  const helper = (spec: unknown) => ({ ...CONFIG, helpers: { module: "./helpers", functions: { plural: spec } } });
  const cases: [string, unknown, ErrorCode, RegExp][] = [
    ["null", null, "FV1113", /^ferrovue\.config\.json holds `null`, where it holds an object/],
    ["an array", [CONFIG], "FV1113", /holds an array/],
    ["a string", "components", "FV1113", /holds a string/],
    ["a misspelt key", { components: "components", out: "out", store: "stores" }, "FV1114", /^ferrovue\.config\.json has no key `store`: did you mean `stores`\?$/],
    ["a misspelt required key", { component: "components", out: "out" }, "FV1114", /did you mean `components`\?/],
    ["a key in the wrong case", { ...CONFIG, I18n: { messages: "locales" } }, "FV1114", /did you mean `i18n`\?/],
    ["a key like none", { ...CONFIG, plugins: [] }, "FV1114", /has no key `plugins`: it takes `components`, `out`/],
    ["a misspelt key in `router`", { ...CONFIG, router: { routes: "routes.json", linkActiveClas: "on" } }, "FV1114", /^`router` in ferrovue\.config\.json has no key `linkActiveClas`: did you mean `linkActiveClass`\?/],
    ["a string of client directives", { ...CONFIG, clientDirectives: "focus" }, "FV1115", /^`clientDirectives` in ferrovue\.config\.json is a list of directive names/],
    ["`router.strict` that is not a boolean", { ...CONFIG, router: { routes: "routes.json", strict: "yes" } }, "FV1115", /^`router\.strict` in ferrovue\.config\.json is `true` or `false`/],
    ["`router.sensitive` that is not a boolean", { ...CONFIG, router: { routes: "routes.json", sensitive: 1 } }, "FV1115", /^`router\.sensitive` in ferrovue\.config\.json is `true` or `false`/],
    ["`isProduction` that is not a boolean", { ...CONFIG, isProduction: "yes" }, "FV1115", /^`isProduction` in ferrovue\.config\.json is `true` or `false`/],
    ["`comments` that is not a boolean", { ...CONFIG, comments: "keep" }, "FV1115", /^`comments` in ferrovue\.config\.json is `true` or `false`/],
    ["`whitespace` that is no mode", { ...CONFIG, whitespace: "trim" }, "FV1115", /^`whitespace` in ferrovue\.config\.json is `"condense"` or `"trim-edges"`/],
    ["`cssModules` without a pattern", { ...CONFIG, cssModules: {} }, "FV1115", /^`cssModules\.generateScopedName` in ferrovue\.config\.json is a string/],
    ["`cssModules` that is a string", { ...CONFIG, cssModules: "[local]" }, "FV1115", /^`cssModules` in ferrovue\.config\.json is an object/],
    ["a misspelt key in `cssModules`", { ...CONFIG, cssModules: { generateScopedName: "[local]", hashPrefx: "" } }, "FV1114", /did you mean `hashPrefix`\?/],
    ["a helper without `params`", helper({ rust: "crate::plural", returns: "string" }), "FV1115", /`helpers\.functions\.plural\.params` in ferrovue\.config\.json is the list of types/],
    ["a helper without `rust`", helper({ params: [], returns: "string" }), "FV1115", /`helpers\.functions\.plural\.rust` in ferrovue\.config\.json is a string/],
    ["a helper type ferrovue does not know", helper({ rust: "crate::plural", params: ["number"], returns: "string" }), "FV1107", /`helpers\.functions\.plural\.params\[0\]` in ferrovue\.config\.json is "number": a helper or twin takes one of/],
    ["a helper without `returns`", helper({ rust: "crate::plural", params: [] }), "FV1107", /`helpers\.functions\.plural\.returns` in ferrovue\.config\.json is missing/],
    ["a negative `maxLen`", helper({ rust: "crate::plural", params: [], returns: "string", maxLen: -1 }), "FV1115", /`helpers\.functions\.plural\.maxLen`/],
    ["helpers without `functions`", { ...CONFIG, helpers: { module: "./helpers" } }, "FV1115", /`helpers\.functions`/],
    ["a twin prop of an unknown type", { ...CONFIG, twins: { VBtn: { rust: "crate::v_btn", props: { label: "text" } } } }, "FV1107", /`twins\.VBtn\.props\.label` in ferrovue\.config\.json is "text"/],
    ["twins in a list", { ...CONFIG, twins: [] }, "FV1115", /^`twins` in ferrovue\.config\.json is an object of twins/],
    ["twin slots that are not a list", { ...CONFIG, twins: { VBtn: { rust: "crate::v_btn", slots: "default" } } }, "FV1115", /`twins\.VBtn\.slots`/],
    ["routes of neither kind", { ...CONFIG, routes: { folder: "pages" } }, "FV1238", /^`routes` in ferrovue\.config\.json is a JSON file of routes, or `\{ "pages": "…" \}`/],
    ["router routes of neither kind", { ...CONFIG, router: { routes: 1 } }, "FV1238", /^`router\.routes` in/],
    ["a router base that is not a string", { ...CONFIG, router: { routes: "routes.json", base: 1 } }, "FV1115", /^`router\.base` in ferrovue\.config\.json is a string/],
    ["i18n as a string", { ...CONFIG, i18n: "locales" }, "FV1115", /^`i18n` in ferrovue\.config\.json is an object/],
    ["i18n without `messages`", { ...CONFIG, i18n: { locale: "en" } }, "FV1115", /^`i18n\.messages` in ferrovue\.config\.json is a string/],
    ["a fallback locale that is a number", { ...CONFIG, i18n: { messages: "locales", fallbackLocale: 1 } }, "FV1115", /`i18n\.fallbackLocale`/],
    ["stores that is not a string", { ...CONFIG, stores: ["stores"] }, "FV1115", /^`stores` in ferrovue\.config\.json is a string/],
    ["a `trustedHtml` that is not a string", { ...CONFIG, trustedHtml: true }, "FV1115", /^`trustedHtml`/],
    ["a `viteRoot` that is not a string", { ...CONFIG, viteRoot: 1 }, "FV1115", /^`viteRoot`/],
    ["`unions` in a list", { ...CONFIG, unions: ["Tone"] }, "FV1115", /^`unions` in ferrovue\.config\.json is an object of Rust paths by `type` alias/],
    ["a `unions` path that is not a string", { ...CONFIG, unions: { Tone: 1 } }, "FV1115", /^`unions\.Tone` in ferrovue\.config\.json is a string/],
    ["a `unions` path of one name", { ...CONFIG, unions: { Tone: "Tone" } }, "FV1119", /^`unions\.Tone` in ferrovue\.config\.json is "Tone", which is not the path of a Rust type: name the enum from the crate root or a crate the project depends on, as `crate::domain::Tone` or `app_domain::Tone`$/],
    ["a `unions` path through `super`", { ...CONFIG, unions: { Tone: "super::domain::Tone" } }, "FV1119", /is "super::domain::Tone", which is not the path/],
    ["a `unions` path with generic arguments", { ...CONFIG, unions: { Tone: "crate::Tone<'a>" } }, "FV1119", /is "crate::Tone<'a>"/],
    ["a `unions` path with `crate` inside it", { ...CONFIG, unions: { Tone: "app::crate::Tone" } }, "FV1119", /is "app::crate::Tone"/],
    ["a `unions` path that ends in `::`", { ...CONFIG, unions: { Tone: "crate::" } }, "FV1119", /is "crate::"/],
  ];
  for (const [what, config, code, message] of cases) {
    it(`refuses ${what}`, () => {
      const e = refusedWith(config);
      expect(e.code).toBe(code);
      expect(e.message).toMatch(message);
      expect(e.at).toEqual({ file: "ferrovue.config.json" });
    });
  }

  it("takes every key the README lists, and the repository's own configurations", () => {
    const full = {
      ...CONFIG,
      router: { routes: { pages: "pages" }, base: "/app", linkActiveClass: "on", linkExactActiveClass: "here", strict: true, sensitive: false },
      stores: "stores",
      trustedHtml: "ferrovue::html::InlineHtml",
      helpers: { module: "./helpers", functions: { plural: { rust: "crate::plural", params: ["int", "string?"], returns: "string", maxLen: 1 } } },
      twins: { VBtn: { rust: "crate::v_btn", props: { label: "string" }, slots: ["default"] } },
      i18n: { messages: "locales", locale: "en", fallbackLocale: ["en"] },
      clientDirectives: ["focus"],
      scopeId: "filepath",
      viteRoot: ".",
      comments: true,
      builders: false,
    };
    expect(loadConfig(configured(full))).toEqual(full);
    for (const dir of ["crates/ferrovue/tests/conformance", "examples/fullstack", "examples/greeting"]) {
      expect(() => loadConfig(join(import.meta.dirname, "../../..", dir)), dir).not.toThrow();
    }
  });
});

describe("the project's inputs", () => {
  const failure = (run: () => unknown): GenError => {
    try {
      run();
    } catch (e) {
      if (e instanceof GenError) return e;
      throw e;
    }
    throw new Error("compiled without an error");
  };
  const page = `<template><p /></template>`;

  it("refuses a components, stores or messages directory that does not exist", () => {
    const root = island(page);
    expect(failure(() => generate(root, { components: "nowhere", out: "out" }))).toMatchObject({ code: "FV1116", message: "cannot read the `components` directory `nowhere`: it does not exist", at: { file: "nowhere" } });
    expect(failure(() => generate(root, { ...CONFIG, stores: "stores" }))).toMatchObject({ code: "FV1116", message: "cannot read the `stores` directory `stores`: it does not exist" });
    expect(failure(() => generate(root, { ...CONFIG, i18n: { messages: "locales" } }))).toMatchObject({ code: "FV1116", message: "cannot read the `i18n.messages` directory `locales`: it does not exist" });
    writeFileSync(join(root, "locales"), "");
    expect(failure(() => generate(root, { ...CONFIG, i18n: { messages: "locales" } })).message).toMatch(/it is not a directory$/);
  });

  it("refuses a routes file that is missing, is not JSON, or is not a list of routes", () => {
    const root = island(page);
    const routes = (text: string | null) => {
      if (text !== null) writeFileSync(join(root, "routes.json"), text);
      return failure(() => generate(root, { ...CONFIG, routes: "routes.json" }));
    };
    expect(routes(null)).toMatchObject({ code: "FV1246", message: "routes.json: cannot read the file: it does not exist", at: { file: "routes.json" } });
    const malformed = routes(`["/", "/about"`);
    expect(malformed.code).toBe("FV1247");
    expect(malformed.message).toMatch(/^routes\.json: /);
    expect(malformed.at).toEqual({ file: "routes.json" });
    expect(routes(`{ "path": "/" }`)).toMatchObject({ code: "FV1232", at: { file: "routes.json" } });
    expect(routes(`[{ "name": "home" }]`)).toMatchObject({ code: "FV1233", at: { file: "routes.json" } });
  });

  it("refuses a store or a type file that does not parse, naming the file and where it stopped", () => {
    const root = island(`<script setup lang="ts">
import type { Item } from "../types";
defineProps<{ item: Item }>();
</script>
<template><p>{{ item.name }}</p></template>`);
    writeFileSync(join(root, "types.ts"), "export interface Item {\n  name: string\n  size: = 2;\n}\n");
    const typed = failure(() => compile(root));
    expect(typed.code).toBe("FV0001");
    expect(typed.at).toMatchObject({ file: "types.ts", line: 3 });
    expect(typed.message).toMatch(/^types\.ts:3:\d+: Unexpected token\n 3 \| {3}size: = 2;\n/);
    mkdirSync(join(root, "stores"));
    writeFileSync(join(root, "stores", "prefs.ts"), `import { defineStore } from "pinia";\nexport const usePrefs = defineStore("prefs", {\n`);
    const store = failure(() => generate(root, { ...CONFIG, stores: "stores" }));
    expect(store.code).toBe("FV0001");
    expect(store.at).toMatchObject({ file: "stores/prefs.ts", line: 3, column: 1 });
  });
});
