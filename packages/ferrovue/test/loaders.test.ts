import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GenError } from "../src/errors.ts";
import { generate } from "../src/compiler.ts";
import { type ErrorCode } from "../src/errors.ts";

const roots: string[] = [];

afterEach(() => {
  for (const made of roots.splice(0)) rmSync(made, { recursive: true, force: true });
});

const LOADERS = `import { defineLoader } from "ferrovue";
export interface Post { title: string; tags: string[] }
export const loadPost = defineLoader("loadPost", async (id: number, lang?: string): Promise<Post> => ({ title: String(id) + lang, tags: [] }));
export const loadCount = defineLoader("loadCount", async (): Promise<number> => 1);
export const loadName = defineLoader("loadName", async (id: number, nick: string | null): Promise<string | null> => nick ?? String(id));
export const loadMaybe = defineLoader("loadMaybe", async (): Promise<string | undefined> => undefined);
export const loadWhen = defineLoader("loadWhen", async (): Promise<Date> => new Date());
export interface Stamp { at: Date; seen: (Date | null)[]; by: Record<string, Date> }
export const loadStamps = defineLoader("loadStamps", async (): Promise<Stamp[]> => []);
export const loadDays = defineLoader("loadDays", async (): Promise<Date[] | null> => null);
export const loadSince = defineLoader("loadSince", async (since: Date): Promise<number> => since.getTime());
export const loadUntyped = defineLoader("loadUntyped", async (id: number) => id);
export const loadNamed = defineLoader(String("x"), async (): Promise<number> => 1);
export const loadSync = defineLoader("loadSync", (id: number): Promise<number> => Promise.resolve(id));
export const loadDefault = defineLoader("loadDefault", async (id = 1): Promise<number> => id);
export const loadObject = defineLoader("loadObject", async (q: { id: number }): Promise<number> => q.id);
export const loadAgain = defineLoader("loadPost", async (): Promise<number> => 1);
export interface Query { term: string; page?: number; lang: string | null }
export interface Nested { q: Query }
export const loadFound = defineLoader("loadFound", async (query: Query, max?: number): Promise<string[]> => [query.term + max]);
export const loadNested = defineLoader("loadNested", async (n: Nested): Promise<number> => 1);
export const loadSnake = defineLoader("load_count", async (): Promise<number> => 1);
export async function fetchPost(id: number): Promise<Post> { return { title: String(id), tags: [] }; }
`;

function project(components: Record<string, string>): Map<string, string> {
  const root = mkdtempSync(join(tmpdir(), "ferrovue-"));
  roots.push(root);
  mkdirSync(join(root, "components"), { recursive: true });
  writeFileSync(join(root, "components", "loaders.ts"), LOADERS);
  for (const [name, text] of Object.entries(components)) writeFileSync(join(root, "components", `${name}.vue`), text);
  return generate(root, { components: "components", out: "out" });
}

const sfc = (script: string, template: string, imports = "loadPost, loadCount, loadName") => `<script setup lang="ts">
import { ${imports} } from "./loaders";
const props = defineProps<{ id: number; lang?: string; nick: string | null }>();
${script}
</script>
<template>${template}</template>`;

function refusal(components: Record<string, string>): GenError {
  try {
    project(components);
  } catch (e) {
    if (e instanceof GenError) return e;
    throw e;
  }
  throw new Error("compiled without an error");
}

describe("loaders", () => {
  it("asks for every call of `Promise.all` before the component stops where a result is missing", () => {
    const x = project({ X: sfc("const [post, n] = await Promise.all([loadPost(props.id), loadCount()]);\nawait Promise.all([loadName(props.id, null)]);", "<h1>{{ post.title }} {{ n }}</h1>") }).get("x.rs")!;
    expect(x).toContain("let l_0 = fv_loads.get(super::loaders::LoadPost { id: props.id, lang: None });\n    let l_1 = fv_loads.get(super::loaders::LoadCount);\n    let (Some(l_0), Some(l_1)) = (l_0, l_1) else { return Ok(()); };");
    expect(x).toContain("let (Some(_),) = (l_2,) else { return Ok(()); };");
  });

  it("writes an object argument's fields into the key in sorted order, leaving out the absent optional ones", () => {
    const out = project({ X: sfc("const found = await loadFound({ term: String(props.id), lang: props.nick });", "<b>{{ found.length }}</b>", "loadFound") });
    expect(out.get("x.rs")).toContain("super::loaders::LoadFound { query: super::loaders::LoadFoundQuery { lang: props.nick.as_deref().map(String::from), page: None, term: String::from(&*fv::core::Js(props.id).to_string()) }, max: None }");
    const loaders = out.get("loaders.rs")!;
    expect(loaders).toContain("pub struct LoadFoundQuery {\n    pub lang: Option<String>,\n    pub page: Option<i64>,\n    pub term: String,\n}");
    expect(loaders).toContain('        key.object();\n        key.field("lang", &self.query.lang);\n        if let Some(v) = &self.query.page {\n            key.field("page", v);\n        }\n        key.field("term", &self.query.term);\n        key.end();');
  });

  it.each([
    ["`Promise.all` of a call that is not a loader's", "FV2001", sfc("const [a] = await Promise.all([fetchPost(1)]);", "<b>{{ a }}</b>", "fetchPost"), /`Promise.all` takes their calls/],
    ["the results of `Promise.all` bound to an object", "FV2007", sfc("const { length } = await Promise.all([loadCount()]);", "<b>{{ length }}</b>", "loadCount"), /bound to an array of plain names/],
    ["an object argument with a field the parameter lacks", "FV2006", sfc('const f = await loadFound({ term: "a", lang: null, sort: 1 });', "<b>{{ f.length }}</b>", "loadFound"), /has no field `sort`/],
    ["an object parameter holding an object", "FV2003", sfc("const n = await loadNested({ q: { term: \"a\", lang: null } });", "<b>{{ n }}</b>", "loadNested"), /an object whose field `q`/],
  ])("refuses %s", (_, code, source, message) => {
    const e = refusal({ X: source });
    expect(e.code).toBe(code);
    expect(e.message).toMatch(message);
  });

  it("stops the render where the component awaits a loader, until the result is in", () => {
    const out = project({ X: sfc("const post = await loadPost(props.id, props.lang);\nconst n = await loadCount();", "<h1>{{ post.title }} {{ n }}</h1>") });
    const x = out.get("x.rs")!;
    expect(x).toContain("pub fn try_render(out: &mut String, props: &Props<'_>, fv_loads: &fv::loaders::Loads<'_>) -> Result<(), fv::render::Refused> {");
    expect(x).toContain("let Some(l_0) = fv_loads.get(super::loaders::LoadPost { id: props.id, lang: props.lang.as_deref().map(String::from) }) else { return Ok(()); };");
    expect(x).toContain("let Some(l_1) = fv_loads.get(super::loaders::LoadCount) else { return Ok(()); };");
    expect(x).not.toContain("pub fn island");
    const loaders = out.get("loaders.rs")!;
    expect(loaders).toContain("pub struct LoadPost {\n    pub id: i64,\n    pub lang: Option<String>,\n}");
    expect(loaders).toContain("type Output = super::types::Post<'static>;");
    expect(loaders).toContain("        key.arg(&self.id);\n        if self.lang.is_some() {\n            key.arg(&self.lang);\n        }");
    expect(loaders).toContain("pub struct LoadCount;");
    expect(loaders).toContain("fn args(&self, _key: &mut fv::loaders::LoadKey) {}");
    expect(loaders).toContain("fn load_post(&self, call: LoadPost) -> impl std::future::Future<Output = Result<<LoadPost as fv::loaders::Load>::Output, Self::Error>> + Send;");
    expect(loaders).not.toContain("LoadName");
    expect(out.get("mod.rs")).toContain("pub mod loaders;");
  });

  it("writes a `null` argument always, and leaves the rest of the module to what is awaited", () => {
    const out = project({ X: sfc("const name = await loadName(props.id, props.nick);", "<b>{{ name }}</b>") });
    expect(out.get("x.rs")).toContain("super::loaders::LoadName { id: props.id, nick: props.nick.as_deref().map(String::from) }");
    expect(out.get("loaders.rs")).toContain("        key.arg(&self.id);\n        key.arg(&self.nick);\n");
  });

  it("destructures a result, and passes the loads to the children that await", () => {
    const child = sfc("const { title, tags: labels } = await loadPost(props.id);", "<b :title=\"labels.join()\">{{ title }}</b>");
    const page = '<script setup lang="ts">\nimport X from "./X.vue";\n</script>\n<template><main><X :id="1" :nick="null" /><X :id="2" nick="n" /></main></template>';
    const out = project({ X: child, Page: page });
    expect(out.get("x.rs")).toContain("fv::core::escape_into(out, &l_0.title);");
    expect(out.get("page.rs")).toContain("pub fn try_render(out: &mut String, _props: &Props, fv_loads: &fv::loaders::Loads<'_>) -> Result<(), fv::render::Refused> {");
    expect(out.get("page.rs")).toContain('super::x::try_render(out, &super::x::Props { id: 2i64, lang: None, nick: Some(std::borrow::Cow::Borrowed("n")) }, fv_loads)?;');
  });

  it("awaits a loader whose result holds dates, written as JsDates with a plan of where they are", () => {
    const template = '<b>{{ when.getTime() }}</b><i v-for="s in stamps">{{ s.at.toISOString() }}{{ s.seen.length }}</i><u v-if="days" v-for="d in days">{{ d.getUTCDate() }}</u>';
    const out = project({ X: sfc("const when = await loadWhen();\nconst stamps = await loadStamps();\nconst days = await loadDays();", template, "loadWhen, loadStamps, loadDays") });
    const loaders = out.get("loaders.rs")!;
    expect(loaders).toContain('    type Output = fv::date::JsDate;\n    const DATES: &\'static str = "[1]";');
    expect(loaders).toContain('    type Output = Vec<super::types::Stamp<\'static>>;\n    const DATES: &\'static str = "[[{\\"at\\":1,\\"seen\\":[1],\\"by\\":{\\"*\\":1}}]]";');
    expect(loaders).toContain('    type Output = Option<Vec<fv::date::JsDate>>;\n    const DATES: &\'static str = "[[1]]";');
    const types = out.get("types.rs")!;
    expect(types).toContain('    #[serde(rename = "at", with = "fv::date::date_prop")]\n    pub at: ferrovue::date::JsDate,');
    expect(types).toContain('    #[serde(rename = "seen", with = "fv::date::dates_in")]\n    pub seen: Vec<Option<ferrovue::date::JsDate>>,');
    expect(types).toContain('    #[serde(rename = "by", with = "fv::date::dates_in")]\n    pub by: ferrovue::props::Record<\'a, ferrovue::date::JsDate>,');
    const x = out.get("x.rs")!;
    expect(x).toContain("fv::core::push_number(out, fv::date::js_time_of(l_0));");
    expect(x).toContain("fv_refusals.keep(fv::date::try_to_iso_string(fv::date::js_time_of(&fv_s.at)), 8, 64)");
    expect(x).toContain("l_2.as_ref().map(|v| v.iter().map(fv::date::js_time_of).collect::<Vec<_>>())");
  });

  it("keeps an await whose result the template does not read", () => {
    const x = project({ X: sfc("await loadCount();\nconst post = await loadPost(1);", "<b>{{ id }}</b>") }).get("x.rs")!;
    expect(x).toContain("if fv_loads.get(super::loaders::LoadCount).is_none() {");
    expect(x).toContain("if fv_loads.get(super::loaders::LoadPost { id: 1i64, lang: None }).is_none() {");
  });

  const refused: [string, ErrorCode, string, RegExp][] = [
    ["an await of a function that is not a loader", "FV2001", sfc("const post = await fetchPost(props.id);", "<b>{{ post.title }}</b>", "fetchPost"), /only a loader's result is awaited on the server/],
    ["a loader whose name is not a literal", "FV2002", sfc("const n = await loadNamed();", "<b>{{ n }}</b>", "loadNamed"), /its name is a string literal/],
    ["a loader that is not async", "FV2002", sfc("const n = await loadSync(1);", "<b>{{ n }}</b>", "loadSync"), /the loader is an `async` function/],
    ["a loader parameter with a default", "FV2003", sfc("const n = await loadDefault();", "<b>{{ n }}</b>", "loadDefault"), /takes plain, typed parameters/],
    ["a loader parameter that is an object", "FV2003", sfc("const n = await loadObject({ id: 1 });", "<b>{{ n }}</b>", "loadObject"), /parameter `q` of loader `loadObject`/],
    ["a loader without a result type", "FV2004", sfc("const n = await loadUntyped(1);", "<b>{{ n }}</b>", "loadUntyped"), /declares what it returns/],
    ["a loader that may return undefined", "FV2004", sfc("const n = await loadMaybe();", "<b>{{ n }}</b>", "loadMaybe"), /may return `undefined`/],
    ["a loader parameter that is a date", "FV2003", sfc("const n = await loadSince(new Date(0));", "<b>{{ n }}</b>", "loadSince"), /parameter `since` of loader `loadSince` is a `Date`/],
    ["two loaders with one name", "FV2005", sfc("const a = await loadPost(1);\nconst b = await loadAgain();", "<b>{{ a.title }}{{ b }}</b>", "loadPost, loadAgain"), /two loaders are called `loadPost`/],
    ["two loaders with one Rust name", "FV2005", sfc("const a = await loadCount();\nconst b = await loadSnake();", "<b>{{ a }}{{ b }}</b>", "loadCount, loadSnake"), /would both be the method `load_count`/],
    ["a loader call without a required argument", "FV2006", sfc("const post = await loadPost();", "<b>{{ post.title }}</b>"), /takes `id`, which the call does not give/],
    ["a loader call with an argument too many", "FV2006", sfc("const n = await loadCount(1);", "<b>{{ n }}</b>"), /takes 0 arguments, and the call gives 1/],
    ["a loader call with an argument of another type", "FV2006", sfc('const post = await loadPost("1");', "<b>{{ post.title }}</b>"), /`id` of `loadPost` is a number/],
    ["a loader call with `undefined` for `null`", "FV2006", sfc("const name = await loadName(1, props.lang);", "<b>{{ name }}</b>"), /`nick` of `loadName`/],
    ["a loader call with a spread argument", "FV2006", sfc("const post = await loadPost(...[1]);", "<b>{{ post.title }}</b>"), /spread from a list/],
    ["a loader result bound to an array pattern", "FV2007", sfc("const [first] = await loadPost(1);", "<b>{{ first }}</b>"), /bound to a name, or destructured/],
    ["a loader result destructured with a default", "FV2007", sfc('const { title = "x" } = await loadPost(1);', "<b>{{ title }}</b>"), /destructured into plain names/],
  ];

  for (const [what, code, component, message] of refused) {
    it(`refuses ${what}`, () => {
      const e = refusal({ X: component });
      expect(e.message).toMatch(message);
      expect(e.code).toBe(code);
      expect(e.at?.line).toBeGreaterThan(0);
    });
  }
});
