import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generate } from "../src/compiler.ts";
import { escapedWrite } from "../src/writes.ts";

const W = "write!(fv::core::escaping(out), ";

describe("text built only to be escaped", () => {
  it("writes a format! through the escaping writer", () => {
    expect(escapedWrite('&format!("{}:{}", a, fv::core::Js(b))')).toBe(`${W}"{}:{}", a, fv::core::Js(b));`);
  });

  it("writes the format! a block ends with after the block's statements", () => {
    expect(escapedWrite('&{ let a = f(); Cow::<str>::Owned(format!("{}!", a)) }')).toBe(`{ let a = f(); ${W}"{}!", a); }`);
    expect(escapedWrite('&{ let a = 1; { let b = a; std::borrow::Cow::<str>::Owned(format!("{}", b)) } }')).toBe(`{ let a = 1; { let b = a; ${W}"{}", b); } }`);
    expect(escapedWrite('&{ for x in y.iter() { n += 1; } if n > 0 { z += 1; } Cow::<str>::Owned(format!("{}", n)) }')).toBe(
      `{ for x in y.iter() { n += 1; } if n > 0 { z += 1; } ${W}"{}", n); }`,
    );
    expect(escapedWrite("&{ 'outer: for x in y { break 'outer; } Cow::<str>::Owned(format!(\"{}\", n)) }")).toBe(`{ 'outer: for x in y { break 'outer; } ${W}"{}", n); }`);
  });

  it("writes each branch of an if the block ends with", () => {
    expect(escapedWrite('&{ let a = g(); if !a.is_empty() { a } else { Cow::<str>::Owned(format!("{}{}", s, s)) } }')).toBe(
      `{ let a = g(); if !a.is_empty() { fv::core::escape_into(out, &a); } else { ${W}"{}{}", s, s); } }`,
    );
    expect(escapedWrite('&{ if t { Cow::<str>::Borrowed("a<b") } else { if u { Cow::<str>::Owned(format!("{}", n)) } else { x } } }')).toBe(
      `{ if t { out.push_str("a&lt;b"); } else { if u { ${W}"{}", n); } else { fv::core::escape_into(out, &x); } } }`,
    );
  });

  it("looks through parentheses and into_owned", () => {
    expect(escapedWrite('&Cow::<str>::Owned(({ let a = 1; Cow::<str>::Owned(format!("{}", a)) }).into_owned())')).toBe(`{ let a = 1; ${W}"{}", a); }`);
  });

  it("writes a JSON list item by item", () => {
    expect(escapedWrite('&format!("[{}]", xs.iter().map(fv::strings::js_json_number).collect::<Vec<_>>().join(","))')).toBe(
      `out.push('['); fv::core::escape_join(out, xs.iter().map(fv::strings::js_json_number), ","); out.push(']');`,
    );
  });

  it("escapes what it cannot write as it goes", () => {
    for (const code of ["&props.s", "&*s", '&{ let a = f(); Cow::<str>::Owned(a) }', "&{ let a = f(); a.to_owned() }", "&fv::strings::js_trim(&format!(\"{}x\", s))", '&{ x; }']) {
      expect(escapedWrite(code)).toBe(`fv::core::escape_into(out, ${code});`);
    }
  });
});

const roots: string[] = [];

afterEach(() => {
  for (const made of roots.splice(0)) rmSync(made, { recursive: true, force: true });
});

function compiled(source: string): string {
  const made = mkdtempSync(join(tmpdir(), "ferrovue-"));
  roots.push(made);
  mkdirSync(join(made, "components"));
  writeFileSync(join(made, "components", "X.vue"), source);
  return generate(made, { components: "components", out: "out" }).get("x.rs")!;
}

describe("a string a loop builds", () => {
  it("prepends in place", () => {
    const out = compiled(`<script setup lang="ts">
defineProps<{ s: string }>();
function backwards(s: string): string {
  let out = "";
  for (const ch of s) out = ch + out;
  return out;
}
function wrapped(s: string): string {
  let out = "";
  for (const ch of s) out = "<" + out;
  return out;
}
</script>
<template><p>{{ backwards(s) }}|{{ wrapped(s) }}</p></template>`);
    expect(out).toContain("fv_out.insert_str(0, fv_ch);");
    expect(out).toContain('fv_out_2.insert_str(0, "<");');
    expect(out).not.toContain("= format!(");
  });
});

describe("a CSS variable", () => {
  it("writes text that is never empty with no empty test, and tests text that may be", () => {
    const out = compiled(`<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ n: number; s: string }>();
const both = computed(() => props.s + props.s);
</script>
<template><p></p></template>
<style>
p { width: v-bind('n + "px"'); --both: v-bind(both); }
</style>`);
    expect(out).toContain("fv::core::push_int(out, props.n);");
    expect(out).toContain("if s_both.is_empty() {");
  });
});
