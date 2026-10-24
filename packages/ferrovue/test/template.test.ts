import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GenError, GenErrors, generate } from "../src/compiler.ts";

const roots: string[] = [];

function sfc(props: string, template: string, script = ""): string {
  return `<script setup lang="ts">\n${script}${props ? `defineProps<{ ${props} }>();\n` : ""}</script>\n<template>${template}</template>\n`;
}

function project(source: string, others: Record<string, string>): string {
  const made = mkdtempSync(join(tmpdir(), "ferrovue-"));
  roots.push(made);
  const dir = join(made, "components");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "X.vue"), source);
  for (const [name, text] of Object.entries(others)) writeFileSync(join(dir, `${name}.vue`), text);
  return made;
}

function render(source: string, others: Record<string, string> = {}, config: Record<string, unknown> = {}): string {
  const out = generate(project(source, others), { components: "components", out: "out", ...config }).get("x.rs")!;
  return /pub fn try_render[\s\S]*?\n}\n/.exec(out)![0];
}

function refusals(source: string, others: Record<string, string> = {}, config: Record<string, unknown> = {}): string[] {
  try {
    generate(project(source, others), { components: "components", out: "out", ...config });
  } catch (e) {
    if (e instanceof GenErrors) return e.errors.map((one) => (one instanceof GenError ? `${one.code} ${one.what}` : String(one)));
    if (e instanceof GenError) return [`${e.code} ${e.what}`];
    throw e;
  }
  throw new Error("compiled without an error");
}

afterEach(() => {
  for (const made of roots.splice(0)) rmSync(made, { recursive: true, force: true });
});

describe("content Vue renders from virtual nodes", () => {
  it("refuses v-show beside a bound style", () => {
    expect(refusals(sfc(`tag: "b" | "i"; on: boolean; a: string`, `<component :is="tag"><span v-show="on" :style="{ color: a }">x</span></component>`))).toEqual([
      "FV0423 `v-show` in content Vue renders from virtual nodes (in an element `<component :is>` chooses, a `<RouterLink>` or a twin's slot, or in slot content they render), where Vue writes no `style` while it shows: bind `:style` or use `v-if`",
    ]);
  });

  it("refuses v-show beside a style array with a hole", () => {
    expect(refusals(sfc(`tag: "b" | "i"; on: boolean; a: string`, `<component :is="tag"><span v-show="on" :style="[{ color: a }, , { color: a }]">x</span></component>`))).toEqual([
      "FV0423 `v-show` in content Vue renders from virtual nodes (in an element `<component :is>` chooses, a `<RouterLink>` or a twin's slot, or in slot content they render), where Vue writes no `style` while it shows: bind `:style` or use `v-if`",
    ]);
  });

  it("keeps a bound style that hides by a test of its own", () => {
    expect(render(sfc(`tag: "b" | "i"; on: boolean; a: string`, `<component :is="tag"><span :style="on ? { color: a } : { display: 'none' }">x</span></component>`))).toBe(`pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::Refused> {
    out.reserve(50 + 1 + props.a.len());
    let fv_tag = match props.tag { XTag::B => "b", XTag::I => "i" };
    out.push('<');
    out.push_str(fv_tag);
    out.push_str("><span style=\\"");
    if props.on {
        out.push_str("color:");
        fv::escape_into(out, &props.a);
        out.push(';');
    }
    if !props.on {
        out.push_str("display:none;");
    }
    out.push_str("\\">x</span></");
    out.push_str(fv_tag);
    out.push('>');
    Ok(())
}
`);
  });

  it("keeps a bound style whose hidden branch holds more than display", () => {
    expect(render(sfc(`tag: "b" | "i"; on: boolean; a: string`, `<component :is="tag"><span :style="on ? null : { display: 'none', color: a }">x</span></component>`))).toBe(`pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::Refused> {
    out.reserve(50 + 1 + props.a.len());
    let fv_tag = match props.tag { XTag::B => "b", XTag::I => "i" };
    out.push('<');
    out.push_str(fv_tag);
    out.push_str("><span style=\\"");
    if !props.on {
        out.push_str("display:none;");
    }
    if !props.on {
        out.push_str("color:");
        fv::escape_into(out, &props.a);
        out.push(';');
    }
    out.push_str("\\">x</span></");
    out.push_str(fv_tag);
    out.push('>');
    Ok(())
}
`);
  });

  it("keeps a bound style whose hidden branch sets another property to none", () => {
    expect(render(sfc(`tag: "b" | "i"; on: boolean; a: string`, `<component :is="tag"><span :style="on ? null : { color: 'none' }">x</span></component>`))).toBe(`pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::Refused> {
    out.reserve(41 + 1 + props.a.len());
    let fv_tag = match props.tag { XTag::B => "b", XTag::I => "i" };
    out.push('<');
    out.push_str(fv_tag);
    out.push_str("><span style=\\"");
    if !props.on {
        out.push_str("color:none;");
    }
    out.push_str("\\">x</span></");
    out.push_str(fv_tag);
    out.push('>');
    Ok(())
}
`);
  });

  it("keeps a bound style whose hidden branch shows the element otherwise", () => {
    expect(render(sfc(`tag: "b" | "i"; on: boolean; a: string`, `<component :is="tag"><span :style="on ? null : { display: 'block' }">x</span></component>`))).toBe(`pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::Refused> {
    out.reserve(44 + 1 + props.a.len());
    let fv_tag = match props.tag { XTag::B => "b", XTag::I => "i" };
    out.push('<');
    out.push_str(fv_tag);
    out.push_str("><span style=\\"");
    if !props.on {
        out.push_str("display:block;");
    }
    out.push_str("\\">x</span></");
    out.push_str(fv_tag);
    out.push('>');
    Ok(())
}
`);
  });

  it("refuses a bound style written as v-show writes it, with a quoted key", () => {
    expect(refusals(sfc(`tag: "b" | "i"; on: boolean; a: string`, `<component :is="tag"><span :style="on ? null : { 'display': 'none' }">x</span></component>`))).toEqual([
      "FV0423 `v-show` in content Vue renders from virtual nodes (in an element `<component :is>` chooses, a `<RouterLink>` or a twin's slot, or in slot content they render), where Vue writes no `style` while it shows: bind `:style` or use `v-if`",
    ]);
  });

  it("refuses a style branch that is a string, by the style's own rule", () => {
    expect(refusals(sfc(`tag: "b" | "i"; on: boolean; a: string`, `<component :is="tag"><span :style="on ? null : a">x</span></component>`))).toEqual([
      "FV1010 a style binding is an object, an array of objects, or a string on its own",
    ]);
  });

  it("refuses a style branch that spreads an object, by the style's own rule", () => {
    expect(refusals(sfc(`tag: "b" | "i"; on: boolean`, `<component :is="tag"><span :style="on ? null : { ...s }">x</span></component>`, `const s = { color: "red" };
`))).toEqual([
      "FV1008 a style object holds plain `property: value` pairs",
    ]);
  });

  it("refuses a style branch with a method, by the style's own rule", () => {
    expect(refusals(sfc(`tag: "b" | "i"; on: boolean`, `<component :is="tag"><span :style="on ? null : { display() { return 1; } }">x</span></component>`))).toEqual([
      "FV1008 a style object holds plain `property: value` pairs",
    ]);
  });

  it("keeps a selected option bound to a call with no arguments", () => {
    expect(render(sfc(`tag: "b" | "i"; label: string`, `<component :is="tag"><select><option :selected="label.trim()">x</option></select></component>`))).toBe(`pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::Refused> {
    out.reserve(51 + 1 + props.label.len());
    let fv_tag = match props.tag { XTag::B => "b", XTag::I => "i" };
    out.push('<');
    out.push_str(fv_tag);
    out.push_str("><select><option selected>x</option></select></");
    out.push_str(fv_tag);
    out.push('>');
    Ok(())
}
`);
  });

  it("keeps a checkbox bound with v-model", () => {
    expect(render(sfc(`tag: "b" | "i"`, `<component :is="tag"><input type="checkbox" v-model="on"></component>`, `import { ref } from "vue";
const on = ref(false);
`))).toBe(`pub fn try_render(out: &mut String, props: &Props) -> Result<(), fv::Refused> {
    out.reserve(30 + 1);
    let fv_tag = match props.tag { XTag::B => "b", XTag::I => "i" };
    out.push('<');
    out.push_str(fv_tag);
    out.push_str("><input type=\\"checkbox\\"></");
    out.push_str(fv_tag);
    out.push('>');
    Ok(())
}
`);
  });

  it("lowercases the names of static attributes, keeps their values, and writes an empty value as the bare name, except for class", () => {
    expect(render(sfc(`tag: "b" | "i"`, `<component :is="tag"><i title="a B" data-Q class="" DATA-y="" id="">x</i></component>`))).toBe(`pub fn try_render(out: &mut String, props: &Props) -> Result<(), fv::Refused> {
    out.reserve(53 + 1);
    let fv_tag = match props.tag { XTag::B => "b", XTag::I => "i" };
    out.push('<');
    out.push_str(fv_tag);
    out.push_str("><i title=\\"a B\\" data-q class=\\"\\" data-y id>x</i></");
    out.push_str(fv_tag);
    out.push('>');
    Ok(())
}
`);
  });

  it("keeps markup inside comments as it is", () => {
    expect(render(sfc(`tag: "b" | "i"`, `<component :is="tag"><i>x<!-- a <i X=""> --><!-- b --><!-- <b Z=""> --></i></component>`))).toBe(`pub fn try_render(out: &mut String, props: &Props) -> Result<(), fv::Refused> {
    out.reserve(61 + 1);
    let fv_tag = match props.tag { XTag::B => "b", XTag::I => "i" };
    out.push('<');
    out.push_str(fv_tag);
    out.push_str("><i>x<!-- a <i X=\\"\\"> --><!-- b --><!-- <b Z=\\"\\"> --></i></");
    out.push_str(fv_tag);
    out.push('>');
    Ok(())
}
`);
  });

  it("writes a slot's content of comments and whitespace as filled", () => {
    expect(render(sfc("on: boolean", `<C tag="b"><template v-if="on">x</template><!-- c --> <!-- e --></C>`, `import C from "./C.vue";
`), { C: sfc(`tag: "b" | "i"`, `<component :is="tag"><slot /></component>`) })).toBe(`pub fn try_render(out: &mut String, props: &Props) -> Result<(), fv::Refused> {
    out.reserve(48);
    super::c::try_render(out, &super::c::Props { tag: super::c::CTag::B }, super::c::Slots {
        default: Some(fv::Slot::markup(&|out: &mut String| -> bool {
            let mut filled = false;
            if props.on {
                filled = true;
                out.push_str("<!--[-->x<!--]-->");
            } else {
                out.push_str("<!--v-if-->");
            }
            out.push_str("<!-- c --><!-- e -->");
            filled
        })),
    })?;
    Ok(())
}
`);
  });

  it("writes a slot's content of comments only as empty", () => {
    expect(render(sfc("on: boolean", `<C tag="b"><template v-if="on">x</template><!-- c --></C>`, `import C from "./C.vue";
`), { C: sfc(`tag: "b" | "i"`, `<component :is="tag"><slot /></component>`) })).toBe(`pub fn try_render(out: &mut String, props: &Props) -> Result<(), fv::Refused> {
    out.reserve(38);
    super::c::try_render(out, &super::c::Props { tag: super::c::CTag::B }, super::c::Slots {
        default: Some(fv::Slot::markup(&|out: &mut String| -> bool {
            let mut filled = false;
            if props.on {
                filled = true;
                out.push_str("<!--[-->x<!--]-->");
            } else {
                out.push_str("<!--v-if-->");
            }
            out.push_str("<!-- c -->");
            filled
        })),
    })?;
    Ok(())
}
`);
  });

  it("writes a slot's content of an interpolation between comments as filled", () => {
    expect(render(sfc("a: string", `<C tag="b"><!-- c -->{{ a }}<!-- e --></C>`, `import C from "./C.vue";
`), { C: sfc(`tag: "b" | "i"`, `<component :is="tag"><slot /></component>`) })).toBe(`pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::Refused> {
    out.reserve(20 + props.a.len());
    super::c::try_render(out, &super::c::Props { tag: super::c::CTag::B }, super::c::Slots {
        default: Some(fv::Slot::markup(&|out: &mut String| -> bool {
            let mut filled = false;
            filled = true;
            out.push_str("<!-- c -->");
            fv::escape_into(out, &props.a);
            out.push_str("<!-- e -->");
            filled
        })),
    })?;
    Ok(())
}
`);
  });

  it("writes a slot's content that renders a component as filled", () => {
    expect(render(sfc("on: boolean", `<C tag="b"><template v-if="on"><C tag="i" /></template></C>`, `import C from "./C.vue";
`), { C: sfc(`tag: "b" | "i"`, `<component :is="tag"><slot /></component>`) })).toBe(`pub fn try_render(out: &mut String, props: &Props) -> Result<(), fv::Refused> {
    out.reserve(11);
    let fv_refusals = fv::Refusals::new(NAME, "components/X.vue");
    fv_refusals.check(super::c::try_render(out, &super::c::Props { tag: super::c::CTag::B }, super::c::Slots {
        default: Some(fv::Slot::markup(&|out: &mut String| -> bool {
            let mut filled = false;
            if props.on {
                filled = true;
                fv_refusals.join(super::c::try_render(out, &super::c::Props { tag: super::c::CTag::I }, super::c::Slots {
                    default: None,
                }));
            } else {
                out.push_str("<!--v-if-->");
            }
            filled
        })),
    }))?;
    fv_refusals.check(Ok(()))
}
`);
  });
});

describe("v-html", () => {
  it("refuses a string on a paragraph by the type's rule", () => {
    expect(refusals(sfc("s: string", `<p v-html="s"></p>`))).toEqual([
      "FV1502 `v-html` renders only a `TrustedHtml` prop (from `ferrovue/types`)",
    ]);
  });

  it("refuses a string that may be absent", () => {
    expect(refusals(sfc("s?: string", `<div v-html="s"></div>`))).toEqual([
      "FV1502 `v-html` renders only a `TrustedHtml` prop (from `ferrovue/types`)",
    ]);
  });

  it("refuses a TrustedHtml prop that may be absent on a paragraph", () => {
    expect(refusals(sfc("h?: TrustedHtml", `<p v-html="h"></p>`, `import type { TrustedHtml } from "ferrovue/types";
`), {}, { trustedHtml: "ferrovue::Sanitised" })).toEqual([
      "FV1513 `v-html` on a `<p>` of HTML that may hold a block (`<p>`, `<ul>`, `<div>`), which ends the `<p>` where the browser reads it: type the prop `InlineHtml` from `ferrovue/types` (`ferrovue::InlineHtml` on the server, which keeps inline tags only), or use a `<div>`",
    ]);
  });

  it("writes a TrustedHtml prop that may be absent", () => {
    expect(render(sfc("h?: TrustedHtml", `<div v-html="h"></div>`, `import type { TrustedHtml } from "ferrovue/types";
`), {}, { trustedHtml: "ferrovue::Sanitised" })).toBe(`pub fn try_render(out: &mut String, props: &Props) -> Result<(), fv::Refused> {
    out.reserve(11 + props.h.as_ref().map_or(0, |v| fv::TrustedHtml::trusted_html(v).len()));
    out.push_str("<div>");
    if let Some(html) = props.h.as_ref() {
        fv::trusted_into(out, html);
    }
    out.push_str("</div>");
    Ok(())
}
`);
  });
});

describe("slot content whose emptiness is decided at run time", () => {
  it("tests a chunk of a comment and an element with a bound attribute", () => {
    expect(render(sfc("on: boolean", `<C><!-- c --><input :checked="on"></C>`, `import C from "./C.vue";
`), { C: sfc("", "<div><slot>fallback</slot></div>") })).toBe(`pub fn try_render(out: &mut String, props: &Props) -> Result<(), fv::Refused> {
    out.reserve(25);
    super::c::try_render(out, &super::c::Props {  }, super::c::Slots {
        default: Some(fv::Slot::markup(&|out: &mut String| -> bool {
            let mut filled = false;
            let fv_chunk = out.len();
            out.push_str("<!-- c --><input");
            if props.on {
                out.push_str(" checked");
            }
            out.push('>');
            filled |= !fv::is_comment(&out[fv_chunk..]);
            filled
        })),
    })?;
    Ok(())
}
`);
  });

  it("takes text after an element as content", () => {
    expect(render(sfc("on: boolean", `<C><!-- c --><input :checked="on">x</C>`, `import C from "./C.vue";
`), { C: sfc("", "<div><slot>fallback</slot></div>") })).toBe(`pub fn try_render(out: &mut String, props: &Props) -> Result<(), fv::Refused> {
    out.reserve(26);
    super::c::try_render(out, &super::c::Props {  }, super::c::Slots {
        default: Some(fv::Slot::new(&|out: &mut String| {
            out.push_str("<!-- c --><input");
            if props.on {
                out.push_str(" checked");
            }
            out.push_str(">x");
        })),
    })?;
    Ok(())
}
`);
  });

  it("takes text before an element as content", () => {
    expect(render(sfc("on: boolean", `<C>x<input :checked="on"></C>`, `import C from "./C.vue";
`), { C: sfc("", "<div><slot>fallback</slot></div>") })).toBe(`pub fn try_render(out: &mut String, props: &Props) -> Result<(), fv::Refused> {
    out.reserve(16);
    super::c::try_render(out, &super::c::Props {  }, super::c::Slots {
        default: Some(fv::Slot::new(&|out: &mut String| {
            out.push_str("x<input");
            if props.on {
                out.push_str(" checked");
            }
            out.push('>');
        })),
    })?;
    Ok(())
}
`);
  });

  it("takes a dash before an interpolation as content", () => {
    expect(render(sfc("a: string", "<C>-{{ a }}<!-- e --></C>", `import C from "./C.vue";
`), { C: sfc("", "<div><slot>fallback</slot></div>") })).toBe(`pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::Refused> {
    out.reserve(11 + props.a.len());
    super::c::try_render(out, &super::c::Props {  }, super::c::Slots {
        default: Some(fv::Slot::new(&|out: &mut String| {
            out.push('-');
            fv::escape_into(out, &props.a);
            out.push_str("<!-- e -->");
        })),
    })?;
    Ok(())
}
`);
  });

  it("tests a chunk where a dash meets an interpolation after a comment", () => {
    expect(render(sfc("a: string", "<C><!-- c -->-{{ a }}<!-- e --></C>", `import C from "./C.vue";
`), { C: sfc("", "<div><slot>fallback</slot></div>") })).toBe(`pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::Refused> {
    out.reserve(21 + props.a.len());
    super::c::try_render(out, &super::c::Props {  }, super::c::Slots {
        default: Some(fv::Slot::markup(&|out: &mut String| -> bool {
            let mut filled = false;
            let fv_chunk = out.len();
            out.push_str("<!-- c -->-");
            fv::escape_into(out, &props.a);
            out.push_str("<!-- e -->");
            filled |= !fv::is_comment(&out[fv_chunk..]);
            filled
        })),
    })?;
    Ok(())
}
`);
  });

  it("tests a chunk where an interpolation meets a dash before a comment", () => {
    expect(render(sfc("a: string", "<C><!-- c -->{{ a }}-<!-- e --></C>", `import C from "./C.vue";
`), { C: sfc("", "<div><slot>fallback</slot></div>") })).toBe(`pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::Refused> {
    out.reserve(21 + props.a.len());
    super::c::try_render(out, &super::c::Props {  }, super::c::Slots {
        default: Some(fv::Slot::markup(&|out: &mut String| -> bool {
            let mut filled = false;
            let fv_chunk = out.len();
            out.push_str("<!-- c -->");
            fv::escape_into(out, &props.a);
            out.push_str("-<!-- e -->");
            filled |= !fv::is_comment(&out[fv_chunk..]);
            filled
        })),
    })?;
    Ok(())
}
`);
  });

  it("tests a chunk of whitespace and an interpolation between comments", () => {
    expect(render(sfc("a: string", "<C><!-- c --> {{ a }} <!-- e --></C>", `import C from "./C.vue";
`), { C: sfc("", "<div><slot>fallback</slot></div>") })).toBe(`pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::Refused> {
    out.reserve(22 + props.a.len());
    super::c::try_render(out, &super::c::Props {  }, super::c::Slots {
        default: Some(fv::Slot::markup(&|out: &mut String| -> bool {
            let mut filled = false;
            let fv_chunk = out.len();
            out.push_str("<!-- c --> ");
            fv::escape_into(out, &props.a);
            out.push_str(" <!-- e -->");
            filled |= !fv::is_comment(&out[fv_chunk..]);
            filled
        })),
    })?;
    Ok(())
}
`);
  });

  it("tests a chunk with a bound attribute and an interpolation between comments", () => {
    expect(render(sfc("on: boolean; a: string", `<C><!-- c --><input :checked="on">{{ a }}<!-- e --></C>`, `import C from "./C.vue";
`), { C: sfc("", "<div><slot>fallback</slot></div>") })).toBe(`pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::Refused> {
    out.reserve(35 + props.a.len());
    super::c::try_render(out, &super::c::Props {  }, super::c::Slots {
        default: Some(fv::Slot::markup(&|out: &mut String| -> bool {
            let mut filled = false;
            let fv_chunk = out.len();
            out.push_str("<!-- c --><input");
            if props.on {
                out.push_str(" checked");
            }
            out.push('>');
            fv::escape_into(out, &props.a);
            out.push_str("<!-- e -->");
            filled |= !fv::is_comment(&out[fv_chunk..]);
            filled
        })),
    })?;
    Ok(())
}
`);
  });

  it("takes text before an interpolation between comments as content", () => {
    expect(render(sfc("a: string", "<C><!-- c -->x{{ a }}<!-- e --></C>", `import C from "./C.vue";
`), { C: sfc("", "<div><slot>fallback</slot></div>") })).toBe(`pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::Refused> {
    out.reserve(21 + props.a.len());
    super::c::try_render(out, &super::c::Props {  }, super::c::Slots {
        default: Some(fv::Slot::new(&|out: &mut String| {
            out.push_str("<!-- c -->x");
            fv::escape_into(out, &props.a);
            out.push_str("<!-- e -->");
        })),
    })?;
    Ok(())
}
`);
  });

  it("takes text between comments as content", () => {
    expect(render(sfc("", "<C><!-- c -->x<!-- e --></C>", `import C from "./C.vue";
`), { C: sfc("", "<div><slot>fallback</slot></div>") })).toBe(`pub fn try_render(out: &mut String, _props: &Props) -> Result<(), fv::Refused> {
    out.reserve(21);
    super::c::try_render(out, &super::c::Props {  }, super::c::Slots {
        default: Some(fv::Slot::new(&|out: &mut String| {
            out.push_str("<!-- c -->x<!-- e -->");
        })),
    })?;
    Ok(())
}
`);
  });

  it("takes a run of comments as no content", () => {
    expect(render(sfc("on: boolean", `<C><template v-if="on">x</template><!-- c --><!-- e --></C>`, `import C from "./C.vue";
`), { C: sfc("", "<div><slot>fallback</slot></div>") })).toBe(`pub fn try_render(out: &mut String, props: &Props) -> Result<(), fv::Refused> {
    out.reserve(44);
    super::c::try_render(out, &super::c::Props {  }, super::c::Slots {
        default: Some(fv::Slot::markup(&|out: &mut String| -> bool {
            let mut filled = false;
            if props.on {
                filled = true;
                out.push_str("<!--[-->x<!--]-->");
            } else {
                out.push_str("<!---->");
            }
            out.push_str("<!-- c --><!-- e -->");
            filled
        })),
    })?;
    Ok(())
}
`);
  });
});

describe("Suspense", () => {
  it("writes a comment where there is only a fallback", () => {
    expect(render(sfc("", "<div><Suspense><template #fallback>f</template></Suspense></div>"))).toBe(`pub fn try_render(out: &mut String, _props: &Props) -> Result<(), fv::Refused> {
    out.reserve(18);
    out.push_str("<div><!----></div>");
    Ok(())
}
`);
  });

  it("writes the default content when the fallback comes first", () => {
    expect(render(sfc("", "<div><Suspense><template #fallback>f</template><template #default>d</template></Suspense></div>"))).toBe(`pub fn try_render(out: &mut String, _props: &Props) -> Result<(), fv::Refused> {
    out.reserve(12);
    out.push_str("<div>d</div>");
    Ok(())
}
`);
  });
});

describe("components and directives resolved by name", () => {
  it("refuses a component neither imported nor this one", () => {
    expect(refusals(sfc("", "<div><Foo /></div>"))).toEqual([
      "FV0513 `<Foo>` is a component the template resolves by name, which must be imported, or be this one",
      "FV0501 a child component must be imported from a `.vue` file among the components compiled, in components",
    ]);
  });

  it("renders this component by its own name", () => {
    expect(render(sfc("n: number", `<div><X v-if="n > 0" :n="n - 1" /></div>`))).toBe(`pub fn try_render(out: &mut String, props: &Props) -> Result<(), fv::Refused> {
    out.reserve(18);
    let fv_refusals = fv::Refusals::new(NAME, "components/X.vue");
    out.push_str("<div>");
    if props.n as f64 > 0.0 {
        fv_refusals.check(super::x::try_render(out, &super::x::Props { n: fv_refusals.keep(fv::try_int(props.n as f64 - 1.0), 4, 36) }))?;
    } else {
        out.push_str("<!---->");
    }
    out.push_str("</div>");
    fv_refusals.check(Ok(()))
}
`);
  });

  it("takes a global directive the configuration declares client-only", () => {
    expect(render(sfc("", "<div><b v-foo>x</b></div>"), {}, { clientDirectives: ["foo"] })).toBe(`pub fn try_render(out: &mut String, _props: &Props) -> Result<(), fv::Refused> {
    out.reserve(19);
    out.push_str("<div><b>x</b></div>");
    Ok(())
}
`);
  });

  it("takes a client-only directive on an element with no content", () => {
    expect(render(sfc("", "<div><b v-foo /></div>"), {}, { clientDirectives: ["foo"] })).toBe(`pub fn try_render(out: &mut String, _props: &Props) -> Result<(), fv::Refused> {
    out.reserve(18);
    out.push_str("<div><b></b></div>");
    Ok(())
}
`);
  });

  it("takes a client-only directive on an element with no content in slot content", () => {
    const box = sfc("", "<section><slot /></section>");
    expect(render(sfc("n: string", `<div><Box><b v-foo :title="n" /></Box></div>`, `import Box from "./Box.vue";\n`), { Box: box }, { clientDirectives: ["foo"] })).toBe(`pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::Refused> {
    out.reserve(33 + props.n.len());
    out.push_str("<div>");
    super::r#box::try_render(out, &super::r#box::Props {  }, super::r#box::Slots {
        default: Some(fv::Slot::new(&|out: &mut String| {
            out.push_str("<b");
            if props.n.is_empty() {
                out.push_str(" title");
            } else {
                out.push_str(" title=\\"");
                fv::escape_into(out, &props.n);
                out.push('"');
            }
            out.push_str("></b>");
        })),
    })?;
    out.push_str("</div>");
    Ok(())
}
`);
  });

  it("refuses a global directive the configuration does not declare client-only", () => {
    expect(refusals(sfc("", "<div><b v-foo>x</b></div>"))).toEqual([
      "FV0405 custom directive `v-foo` may add attributes on the server; if it has no `getSSRProps`, list `foo` in `clientDirectives` in ferrovue.config.json",
    ]);
  });

  it("takes a global directive named like a component the router resolves", () => {
    expect(render(sfc("", "<div><b v-RouterLink>x</b></div>"), {}, { clientDirectives: ["RouterLink"] })).toBe(`pub fn try_render(out: &mut String, _props: &Props) -> Result<(), fv::Refused> {
    out.reserve(19);
    out.push_str("<div><b>x</b></div>");
    Ok(())
}
`);
  });

  it("takes a global directive beside a ClientOnly", () => {
    expect(render(sfc("", "<div><ClientOnly><i>c</i></ClientOnly><b v-foo>x</b></div>", `import { ClientOnly } from "ferrovue/client";
`), {}, { clientDirectives: ["foo"] })).toBe(`pub fn try_render(out: &mut String, _props: &Props) -> Result<(), fv::Refused> {
    out.reserve(26);
    out.push_str("<div><!----><b>x</b></div>");
    Ok(())
}
`);
  });
});

describe("v-if", () => {
  it("leaves out the comment where Vue does, in a TransitionGroup", () => {
    expect(render(sfc("on: boolean; a?: string", `<TransitionGroup tag="ul"><li v-if="on" key="1">x</li><li v-if="a" key="2">{{ a }}</li><li v-if="!a" key="3">no</li><li v-if="false" key="4">f</li><li v-if="a && on" key="5">{{ a }}</li><li v-if="a && false" key="6">f</li></TransitionGroup>`))).toBe(`pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::Refused> {
    out.reserve(48 + props.a.as_deref().map_or(0, str::len));
    out.push_str("<ul>");
    if props.on {
        out.push_str("<li>x</li>");
    }
    if let Some(fv_a) = props.a.as_deref().filter(|v| !v.is_empty()) {
        out.push_str("<li>");
        fv::escape_into(out, fv_a);
        out.push_str("</li>");
    }
    if !props.a.as_deref().is_some_and(|v| !v.is_empty()) {
        out.push_str("<li>no</li>");
    }
    if let Some(fv_a_2) = props.a.as_deref().filter(|v| !v.is_empty()) && props.on {
        out.push_str("<li>");
        fv::escape_into(out, fv_a_2);
        out.push_str("</li>");
    }
    out.push_str("</ul>");
    Ok(())
}
`);
  });

  it("tests at run time a value that is always truthy, unless the test is a logical expression or a negation", () => {
    expect(render(sfc("on: boolean; xs?: string[]; ys: string[]; a?: string", `<div><b v-if="on ? 'a' : 'b'">1</b><b v-if="xs ?? ys">2</b><b v-if="typeof a">3</b></div>`))).toBe(`pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::Refused> {
    out.reserve(56 + props.ys.iter().map(|v| v.len()).sum::<usize>() + props.a.as_deref().map_or(0, str::len));
    out.push_str("<div>");
    if true {
        out.push_str("<b>1</b>");
    } else {
        out.push_str("<!---->");
    }
    if true {
        out.push_str("<b>2</b>");
    } else {
        out.push_str("<!---->");
    }
    if true {
        out.push_str("<b>3</b>");
    } else {
        out.push_str("<!---->");
    }
    out.push_str("</div>");
    Ok(())
}
`);
  });

  it("translates a negated test as a condition", () => {
    expect(render(sfc("a?: string; n?: number", `<div><b v-if="!(a && n)">x</b></div>`))).toBe(`pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::Refused> {
    out.reserve(26 + props.a.as_deref().map_or(0, str::len));
    out.push_str("<div>");
    if !(if props.a.as_deref().is_some_and(|v| !v.is_empty()) { props.n.is_some_and(|v| v != 0) } else { false }) {
        out.push_str("<b>x</b>");
    } else {
        out.push_str("<!---->");
    }
    out.push_str("</div>");
    Ok(())
}
`);
  });

  it("drops a known true part of a test that narrows", () => {
    expect(render(sfc("a?: string", `<div><p v-if="a && true">{{ a }}</p></div>`))).toBe(`pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::Refused> {
    out.reserve(25 + props.a.as_deref().map_or(0, str::len));
    out.push_str("<div>");
    if let Some(fv_a) = props.a.as_deref().filter(|v| !v.is_empty()) {
        out.push_str("<p>");
        fv::escape_into(out, fv_a);
        out.push_str("</p>");
    } else {
        out.push_str("<!---->");
    }
    out.push_str("</div>");
    Ok(())
}
`);
  });

  it("renders the content alone where every part of an `&&` test is known true", () => {
    expect(render(sfc("on: boolean", `<p v-if="true && true">x</p><p v-else>y</p>`))).toBe(`pub fn try_render(out: &mut String, _props: &Props) -> Result<(), fv::Refused> {
    out.reserve(8);
    out.push_str("<p>x</p>");
    Ok(())
}
`);
  });

  it("translates each test once", () => {
    expect(render(sfc("on: boolean; a?: string", `<div><p v-if="on && (a ? a.length : 0) > 1">y</p><p v-if="(a ? a.length : 0) > 1 || on">z</p><p v-if="a && (on || a.length > 2)">w</p></div>`))).toBe(`pub fn try_render(out: &mut String, props: &Props<'_>) -> Result<(), fv::Refused> {
    out.reserve(56 + props.a.as_deref().map_or(0, str::len));
    out.push_str("<div>");
    if props.on && (if let Some(fv_a) = props.a.as_deref().filter(|v| !v.is_empty()) { fv::js_length(fv_a) } else { 0i64 }) as f64 > 1.0 {
        out.push_str("<p>y</p>");
    } else {
        out.push_str("<!---->");
    }
    if (if let Some(fv_a_2) = props.a.as_deref().filter(|v| !v.is_empty()) { fv::js_length(fv_a_2) } else { 0i64 }) as f64 > 1.0 || props.on {
        out.push_str("<p>z</p>");
    } else {
        out.push_str("<!---->");
    }
    if let Some(fv_a_3) = props.a.as_deref().filter(|v| !v.is_empty()) && (props.on || fv::js_length(fv_a_3) as f64 > 2.0) {
        out.push_str("<p>w</p>");
    } else {
        out.push_str("<!---->");
    }
    out.push_str("</div>");
    Ok(())
}
`);
  });
});

describe("refusals", () => {
  it("refuses an input whose type and v-model are bound", () => {
    expect(refusals(sfc("t: string; x: string", `<div><input :type="t" v-model="x"></div>`))).toEqual([
      "FV0006 this expression cannot be rendered on the server",
    ]);
  });

  it("refuses an object bound whole on a textarea", () => {
    expect(refusals(sfc("", `<div><textarea v-bind="o"></textarea></div>`, `const o = { id: "a" };
`))).toEqual([
      "FV0424 a `<textarea>` given `v-bind` of an object renders as its content a `value` among the attributes it merges: bind each attribute by its name",
    ]);
  });

  it("refuses merged attributes on an SVG element whose tag holds a dash", () => {
    expect(refusals(sfc("", `<div><svg><color-profile v-foo>x</color-profile></svg></div>`), {}, { clientDirectives: ["foo"] })).toEqual([
      "FV0006 `ssrRenderAttrs` with a tag argument",
    ]);
  });

  it("refuses a slot inside a TransitionGroup", () => {
    expect(refusals(sfc("", "<div><TransitionGroup><slot /></TransitionGroup></div>"))).toEqual([
      "FV0006 an expression statement in the compiled template",
    ]);
  });

  it("keeps the names of a loop after a refused statement", () => {
    expect(refusals(sfc("xs: string[]; n: number", `<ul><li v-for="x in xs" :key="x"><p>{{ n.toLocaleString() }}</p><i v-if="x">i</i>{{ x.length }}</li></ul>`))).toEqual([
      "FV1805 `.toLocaleString()` formats by locale with `Intl`, whose output differs between Node, Chromium, Firefox and Safari: format the value in Rust and pass a string, or translate it with `$t` (see the `dates_and_prices` guide)",
    ]);
  });

  it("keeps what a test narrowed after a refused statement", () => {
    expect(refusals(sfc("a?: string; on: boolean; n: number", `<div v-if="a"><p>{{ n.toLocaleString() }}</p><i v-if="on">i</i>{{ a.length }}</div>`))).toEqual([
      "FV1805 `.toLocaleString()` formats by locale with `Intl`, whose output differs between Node, Chromium, Firefox and Safari: format the value in Rust and pass a string, or translate it with `$t` (see the `dates_and_prices` guide)",
    ]);
  });
});
