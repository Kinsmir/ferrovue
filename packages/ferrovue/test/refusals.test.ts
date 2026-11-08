import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.ts";
import { GenError, GenErrors } from "../src/errors.ts";
import { generate } from "../src/compiler.ts";
import { type ErrorCode, ERRORS } from "../src/errors.ts";
import { CONFIG, compile, island } from "./project.ts";
import { refusedExpressions } from "./refused-expressions.ts";
import { refusedValues } from "./refused-values.ts";
import { refusedTypes } from "./refused-types.ts";

describe("the generator", () => {
  describe("every refusal of a run", () => {
    const refusals = (project: string): GenErrors => {
      try {
        compile(project);
      } catch (e) {
        if (e instanceof GenErrors) return e;
        throw e;
      }
      throw new Error("compiled without an error");
    };
    const where = (e: GenErrors): string[] => e.errors.map((one) => (one instanceof GenError ? `${one.code} ${one.at?.file}:${one.at?.line}` : "syntax"));

    it("reports each refused statement of a template, and of every component, in the order of files and lines", () => {
      const e = refusals(
        island(
          `<script setup lang="ts">
defineProps<{ n: number; on: boolean }>();
</script>
<template>
  <p>{{ n.toLocaleString() }}</p>
  <p v-if="on">{{ n.toFixed(200) }}</p>
  <i>{{ n }}</i>
</template>`,
          { A: `<script setup lang="ts">\nimport { watchEffect } from "vue";\nwatchEffect(() => {});\n</script>\n<template><i></i></template>` },
        ),
      );
      expect(where(e)).toEqual(["FV0103 components/A.vue:3", "FV1805 components/X.vue:5", expect.stringMatching(/^FV\d{4} components\/X\.vue:6$/)]);
      expect(e).toBeInstanceOf(GenError);
      expect(e.code).toBe("FV0103");
      expect(e.unchecked).toEqual([]);
    });

    it("leaves a component that uses a refused one unchecked, and checks the rest", () => {
      const bad = `<script setup lang="ts">\ndefineProps<{ n: number }>();\n</script>\n<template><p>{{ n.toLocaleString() }}</p></template>`;
      const e = refusals(
        island(`<script setup lang="ts">\nimport B from "./B.vue";\n</script>\n<template><B :n="1" /><p>{{ (1).toLocaleString() }}</p></template>`, { B: bad, C: bad }),
      );
      expect(where(e)).toEqual(["FV1805 components/B.vue:4", "FV1805 components/C.vue:4"]);
      expect(e.unchecked).toEqual(["components/X.vue"]);
    });

    it("names what the template wrote, says how to get around it, and names syntax in words", () => {
      const project = island(
        `<script setup lang="ts">
import { computed } from "vue";
import { fmt } from "./util";
const props = defineProps<{ n: number; pair: [number, number?] }>();
function twice(x: number) { return x * 2; }
const big = computed(() => {
  while (props.n > 0) return props.n;
  return 0;
});
</script>
<template>
  <p>{{ fmt(n) }}</p>
  <p>{{ fmt }}</p>
  <p>{{ twice }}</p>
  <p>{{ big }}</p>
  <p>{{ nowhere(n) }}</p>
  <p>{{ ({ a: n }) }}</p>
  <p :title="() => n">x</p>
</template>`,
      );
      writeFileSync(join(project, "components", "util.ts"), "export function fmt(n: number): string { return String(n); }\n");
      const e = refusals(project);
      const said = e.errors.map((one) => [(one as GenError).code, (one as GenError).what, (one as GenError).help]);
      expect(said).toEqual([
        ["FV0316", "a tuple with an optional part is not supported as a prop type", "a tuple is read when it has one or more parts, none optional (`?`), none a rest (`...`) and none that may be `undefined`; or declare an interface with a field for each part"],
      ]);
      writeFileSync(join(project, "components", "X.vue"), readFileSync(join(project, "components", "X.vue"), "utf8").replace("; pair: [number, number?]", ""));
      const again = refusals(project).errors.map((one) => [(one as GenError).code, (one as GenError).what, (one as GenError).help]);
      expect(again).toEqual([
        [
          "FV1901",
          "a `computed`'s body may not hold a `while` loop, which the compiler cannot bound: count with `for (let i = start; i < end; i++)` to an integer bound, or iterate with `for (const x of list)` (the template reads it as `big` at components/X.vue:15:9)",
          null,
        ],
        ["FV0613", "`fmt` is set up in a way the server cannot evaluate: it is a function imported from components/util.ts, which the template and a `computed` may call, and only an event handler may name without calling it", "call it, as `fmt(…)`, which the server translates, or name it only in an event handler"],
        ["FV0613", "`twice` is set up in a way the server cannot evaluate: it is a function, which the template and a `computed` may call, and only an event handler may name without calling it", "call it, as `twice(…)`, which the server translates, or name it only in an event handler"],
        ["FV0601", "`nowhere()` is not available when rendering on the server", "a template calls JavaScript's built-ins and the helpers with Rust twins under `helpers.functions` in ferrovue.config.json; compute the value in Rust and pass it as a prop"],
        ["FV0634", "an object literal in the template whose type is not known, which the server builds as the Rust struct of an interface: pass it to a prop typed with an interface, or build it in a `computed` typed with one", null],
        ["FV0625", "an arrow function is not supported in a template", null],
      ]);
    });

    it("refuses a template's read of a constant or a setup binding the compiler cannot evaluate with the refusal's own code and place, and where the template reads it", () => {
      const project = island(`<script setup lang="ts">
import { LIMIT } from "./consts";
const local = (1).toLocaleString();
</script>
<template><i>{{ LIMIT }}</i><b>{{ local }}</b></template>`);
      writeFileSync(join(project, "components", "consts.ts"), "export const LIMIT = Math.random();\n");
      const [constant, local] = refusals(project).errors as GenError[];
      expect(constant).toMatchObject({ code: "FV0207", at: { file: "components/consts.ts", line: 1, column: 22 }, readAt: { file: "components/X.vue", line: 5, column: 17 } });
      expect(constant!.what).toMatch(/\(the template reads it as `LIMIT` at components\/X\.vue:5:17\)$/);
      expect(constant!.message).toMatch(/^components\/consts\.ts:1:22: .*\n 1 \| export const LIMIT = Math\.random\(\);/);
      expect(local).toMatchObject({ code: "FV1805", at: { file: "components/X.vue", line: 3, column: 15 }, readAt: null });
      expect(local!.what).toMatch(/\(the template reads it as `local` at components\/X\.vue:5:35\)$/);
    });

    it("raises a `GenErrors` for a single refusal too", () => {
      const e = refusals(island(`<template><p>{{ (1).toLocaleString() }}</p></template>`));
      expect(e.errors).toHaveLength(1);
      expect(e.message).toBe(e.errors[0]!.message);
    });
  });

  describe("error locations", () => {
    const where = (source: string, others: Record<string, string> = {}): string => {
      try {
        compile(island(source, others));
      } catch (e) {
        return (e as Error).message.split(": ")[0]!;
      }
      throw new Error("compiled without an error");
    };

    it("points at a template expression in the .vue file", () => {
      expect(where(`<script setup lang="ts">
defineProps<{ n: number }>();
</script>

<template>
  <div>
    <p>{{ n.toLocaleString() }}</p>
  </div>
</template>`)).toBe("components/X.vue:7:11");
    });

    it("points at an attribute binding", () => {
      expect(where(`<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><i :title="a.normalize()"></i></template>`)).toBe("components/X.vue:4:22");
    });

    it("points at a template expression on the <template> line itself", () => {
      expect(where(`<script setup lang="ts">
defineProps<{ n: number }>();
</script>
<template><b>{{ n.toLocaleString() }}</b></template>`)).toBe("components/X.vue:4:17");
    });

    it("points at a setup statement and a prop type", () => {
      expect(where(`<script setup lang="ts">
import { watchEffect } from "vue";
defineProps<{ a: string }>();
watchEffect(() => {});
</script>
<template><i></i></template>`)).toBe("components/X.vue:4:1");
      expect(where(`<script setup lang="ts">
defineProps<{
  when: Map<string, string>;
}>();
</script>
<template><i></i></template>`)).toBe("components/X.vue:3:9");
    });

    it("quotes the line with a caret under the construct", () => {
      expect(() =>
        compile(island(`<script setup lang="ts">
defineProps<{ n: number }>();
</script>
<template><b>{{ n.toLocaleString() }}</b></template>`)),
      ).toThrow(" 4 | <template><b>{{ n.toLocaleString() }}</b></template>\n   |                 ^");
    });
  });

  describe("form fields at the root", () => {
    const field = (template: string, script = "const text = defineModel<string>({ required: true });\nconst on = defineModel<boolean>(\"on\", { required: true });"): string => `<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>`;
    const parent = (attrs: string): string => `<script setup lang="ts">\nimport F from "./F.vue";\n</script>\n<template><F model-value="a" :on="true" ${attrs} /></template>`;

    it.each([
      ["a `<textarea>` with content", "<textarea>hi</textarea>", 'out.push_str(">hi</textarea>");'],
      ["a `<textarea>` with `v-model`", '<textarea v-model="text"></textarea>', "fv::core::escape_into(out, &props.model_value);"],
      ["a `<textarea>` in a `v-if` branch", '<textarea v-if="on">hi</textarea><p v-else>none</p>', 'out.push_str(">hi</textarea>");'],
      ["an `<input>` with `v-model`", '<input v-model="text">', '("value", fv::attrs::Attr::str(&props.model_value))'],
      ["a text `<input>` with `v-model`", '<input type="text" v-model="text">', '("type", fv::attrs::Attr::str("text"))'],
      ["a checkbox with `v-model`", '<input type="checkbox" v-model="on">', '("checked", fv::attrs::Attr::Bool(props.on))'],
    ])("renders %s whose parents pass neither `value` nor `type`", (_, template, rust) => {
      const out = compile(island(parent('class="c" title="t"'), { F: field(template) })).get("f.rs")!;
      expect(out).toContain(rust);
      expect(out).toContain("fv_attrs");
    });

    it.each([
      ["a `<textarea>`", "<textarea>hi</textarea>", 'value="v"', "value"],
      ["an `<input>` with `v-model`", '<input v-model="text">', 'type="radio"', "type"],
      ["an `<input>` with `v-model`", '<input type="checkbox" v-model="on">', 'value="v"', "value"],
    ])("refuses %s at the root where a parent passes the attribute it reads", (_, template, attrs, name) => {
      const e = refusal(island(parent(attrs), { F: field(template) }));
      expect(e.code).toBe("FV0424");
      expect(e.message).toMatch(new RegExp(`^components/F\\.vue:5:11: .* at the component's root .* a parent passes \\\`${name}\\\``));
    });

    it.each([
      ["passes no attribute", 'class="c"'],
      ["passes the key", 'k="v"'],
    ])("refuses an `in` test of a loop item beside a root `<textarea>` whose parent %s", (_, attrs) => {
      const child = field('<textarea v-if="on">hi</textarea><p v-else><i v-for="x in xs">{{ "k" in x ? x.k : "n" }}</i></p>', 'defineProps<{ on: boolean; xs: { k?: string }[] }>();');
      const e = refusal(island(`<script setup lang="ts">\nimport F from "./F.vue";\n</script>\n<template><F :on="true" :xs="[]" ${attrs} /></template>`, { F: child }));
      expect(e).toMatchObject({ code: "FV0631", message: expect.stringMatching(/^components\/F\.vue:4:76: `in` tests whether an object has a key/) });
    });
  });

  const refused: [string, string, RegExp][] = [...refusedExpressions, ...refusedValues, ...refusedTypes];

  const children = {
    P: `<script setup lang="ts">
type Pick = "a" | "c";
defineProps<{ p: Pick }>();
</script>
<template><b>{{ p }}</b></template>`,
    U: `<script setup lang="ts">
defineProps<{ k: "a" | "b"; o?: "a" | "b" }>();
</script>
<template><b>{{ k }}{{ o }}</b></template>`,
    Y: `<script setup lang="ts">
defineProps<{ b?: string }>();
</script>
<template><b>{{ b }}</b></template>`,
    Z: `<script setup lang="ts">
defineProps<{ c: string | null }>();
</script>
<template><b>{{ c }}</b></template>`,
    B: `<script setup lang="ts">
defineProps<{ flag: boolean; fooBar?: boolean }>();
</script>
<template><b>{{ flag }}{{ fooBar }}</b></template>`,
    Fr: `<script setup lang="ts">
defineProps<{ t?: string }>();
</script>
<template><div><slot name="head" /><slot name="foot" /></div></template>`,
    W: `<script setup lang="ts">
defineProps<{ onSale?: boolean }>();
</script>
<template><b v-if="onSale">!</b></template>`,
    Q: `<script setup lang="ts">
export interface Props { on1?: number; onAt: number; onNote: string | null }
defineProps<Props>();
</script>
<template><b>{{ on1 }}{{ onAt }}{{ onNote }}</b></template>`,
    V: `<script setup lang="ts">
export interface Item { label: string; n?: number }
defineProps<{ item: Item; items?: Item[] }>();
</script>
<template><b>{{ item.label }}{{ items?.length }}</b></template>`,
    S: `<script setup lang="ts">
export interface Chip { size: "sm" | "md"; label: string }
defineProps<{ chip: Chip }>();
</script>
<template><b :class="chip.size">{{ chip.label }}</b></template>`,
  };

  const codes: Record<string, ErrorCode> = {
    "a for loop that does not count": "FV1909",
    "a counting loop whose step is not a whole number": "FV1909",
    "a counting loop that counts away from its bound": "FV1909",
    "a counting loop whose body assigns its counter": "FV1909",
    "a counting loop whose bound the body changes": "FV1909",
    "a counting loop to a Float bound": "FV1909",
    "a counting loop from a fraction": "FV1909",
    "for await": "FV1909",
    "a for…of loop over a name declared before it": "FV1909",
    "a for…of loop over a number": "FV1910",
    "a for…of loop over an optional list": "FV1910",
    "a loop that carries a list": "FV1911",
    "a return of a list from inside a loop": "FV1911",
    "returns of two types from inside a loop": "FV1911",
    "a let assigned a value of another type": "FV1912",
    "++ of a string": "FV1912",
    "a let that starts as undefined without a type": "FV1912",
    "a let holding a function assigned again": "FV1912",
    "a const assigned again": "FV1902",
    "a parameter assigned": "FV1902",
    "an assignment inside an expression": "FV1902",
    "an increment inside a call": "FV1902",
    "a destructuring assignment": "FV1902",
    "a function of a body reading a let the body assigns": "FV1902",
    "a labelled break": "FV1901",
    "a let assigned again declared without a value": "FV1901",
    "a do…while loop": "FV1901",
    "an object literal with a key its interface does not declare": "FV0635",
    "an object literal that leaves out a required field": "FV0635",
    "an object literal that gives a key twice": "FV0635",
    "an object literal with a computed key the compiler does not know": "FV0635",
    "an object literal with a method": "FV0635",
    "an object literal that sets `__proto__`": "FV0635",
    "an object literal spreading after its own keys": "FV0635",
    "an object literal spreading an object of another type": "FV0635",
    "an object literal whose field is given a value of another type": "FV0635",
    "an object literal giving `null` to an optional field": "FV0606",
    "an object literal giving an optional value to a required field": "FV0606",
    "an object literal in the template with no type": "FV0634",
    "a list method of a list `.map()` makes of object literals": "FV0636",
    "an item of a list `.map()` makes of object literals": "FV0636",
    "an optional chain of an object literal": "FV0636",
    "an optional list of object literals": "FV0636",
    "a literal of a union with no letter or digit to name its variant": "FV0323",
    "two literals of a union that name one variant": "FV0324",
    "two members of an enum that hold one value": "FV0324",
    "a union in place whose enum is named as an interface of the component": "FV0325",
    "a union alias named as a type of Rust's prelude": "FV0325",
    "a `unions` entry for an alias of integer literals": "FV0329",
    "a `unions` entry for an alias of one literal": "FV0329",
    "a `unions` entry for an alias of a union with `string`": "FV0329",
    "a `unions` entry for a union another component declares with other members": "FV0330",
    "a prop with no type": "FV0326",
    "a field of an interface with no type that a prop reaches": "FV0326",
    "props of a type imported from a component": "FV0327",
    "props of a type imported from a package": "FV0327",
    "events of a type imported from a package": "FV0327",
    "a prop named with a leading `$`": "FV0328",
    "a defineModel named with a leading `$`": "FV0328",
    "a named slot given under `v-if`": "FV0901",
    "a named slot given under `v-else`": "FV0901",
    "slots given by `v-for`": "FV0901",
    "`v-model` on an `<input>` whose `type` is bound": "FV0426",
    "an `<option>` with no `value` under a `<select>` whose `v-model` is a number": "FV0413",
    "a `<select>` whose `v-model` is a number": "FV0413",
    "a string given to a child's prop of a union": "FV0515",
    "a literal outside a child's prop of a union": "FV0515",
    "a string other than the prop's name given to a child's boolean prop": "FV0511",
    "the prop's camelCase name given to a child's boolean prop": "FV0511",
    "a string bound to a child's boolean prop": "FV0511",
    "a value of a wider union given to a child's prop of a union": "FV0515",
    "a wider union that may still be its other member given to a child's prop of a union": "FV0515",
    "a wider union narrowed by a test of another member given to a child's prop of a union": "FV0515",
    "a computed typed as a union whose body may give another member": "FV0111",
    "a computed typed as a union whose body is a string": "FV0111",
    "a ref typed as a union whose value may be another string": "FV0111",
    "a union compared with a literal outside it": "FV0637",
    "an optional union compared with a literal outside it": "FV0637",
    "a member of a ref other than `.value` read in setup": "FV0638",
    "a union compared with a literal outside it in a computed's switch": "FV0637",
    "a union's default outside it": "FV0322",
    "a lookup table's value outside the union its type gives": "FV0228",
    "an object literal giving a free string to a field of a union": "FV0635",
    "an object literal giving a literal outside a field's union": "FV0635",
    "an object literal in a computed giving a wider union to a field of a union": "FV0635",
    "a value imported from a module that resolves to no `.ts` file of the project": "FV0110",
    "a type parameter without a constraint": "FV0302",
    "a listener of a name chosen at run time given to a child with a prop named like a listener": "FV0514",
    "a prop named like a listener given twice in props Vue merges": "FV0516",
    "a required prop named like a listener given a value that may be falsy in props Vue merges": "FV0517",
    "a required nullable prop named like a listener given a string that may be empty in props Vue merges": "FV0517",
    "a child's own Props with a required prop named like a listener, merged with attributes": "FV0517",
    "listeners from an object given to a child with a prop named like a listener": "FV0514",
    "an enum read whole": "FV0208",
    "an enum read by a key chosen at run time": "FV0222",
    "a ternary whose branches differ in type, compared": "FV0623",
    "a ternary whose branches differ in type, given to a child's prop": "FV0623",
    "a ternary whose branches differ in type, read by a method": "FV0623",
    "a ternary whose branches differ in type, bound to a boolean attribute": "FV0623",
    "a ternary whose branches differ in type, bound as a class": "FV0623",
    "a ternary between a list and a string in text, which Vue writes as JSON": "FV0623",
    "a constant object read by a key that is a string": "FV0222",
    "a constant object read by a key that may be absent": "FV0223",
    "a field of a constant object read by a key it may not have": "FV0224",
    "a constant object whose values differ in type for the keys of its key": "FV0225",
    "a constant object without a key that names a field of every object": "FV0226",
    "a constant object read by a key that is a union of literals and a string": "FV0222",
    "a constant object literal that sets its prototype": "FV0206",
    "a value read from `$attrs`, which has no type": "FV0415",
    "an attribute name Vue's server renderer skips as unsafe": "FV0404",
    "an attribute name chosen at run time": "FV0408",
    "attributes bound from an object that is not a literal": "FV0410",
    "a runtime props declaration, which has no types": "FV0303",
    "watchEffect, which runs on the server": "FV0103",
    "a setup statement that changes state": "FV0105",
    "an initial value of setup that changes state": "FV0105",
    "an interface whose name the generated Rust already uses": "FV0318",
    "a strict comparison of a value that may be null or undefined": "FV0626",
    "loose equality between values": "FV0619",
    "encodeURIComponent of a string that may hold half of a surrogate pair": "FV0706",
    "encodeURI of an object": "FV0723",
    "String of two values": "FV0723",
    "String of a value that may be null or undefined": "FV0721",
    "a template literal of a value that may be null or undefined": "FV0721",
    "a template literal of an object": "FV0708",
    ".concat() of an object": "FV0723",
    "charCodeAt of a string that may hold half of a surrogate pair": "FV0706",
    "codePointAt of a string that may hold half of a surrogate pair": "FV0706",
    "Math.cbrt, which engines round differently": "FV0719",
    "Math.hypot, which engines round differently": "FV0719",
    "a power of a value known only when rendering": "FV0720",
    "a power with a negative exponent": "FV0720",
    "Math.pow of a fraction": "FV0720",
    "a power beyond 2^53": "FV0720",
    "the in operator": "FV0631",
    "instanceof": "FV0631",
    "a bitwise operator": "FV0632",
    "a shift": "FV0632",
    "JSON.stringify with an indentation": "FV0633",
    "JSON.parse": "FV0633",
    "String.fromCharCode": "FV0633",
    "decodeURIComponent": "FV0633",
    "a Math constant that does not exist": "FV0633",
    "Number.parseFloat": "FV0633",
    "typeof compared with undefined of a value that may be null or undefined": "FV0722",
    "typeof of a value that may be null or undefined": "FV0722",
    "a nullable prop the parent leaves out": "FV0507",
    "two halves of surrogate pairs compared, which JavaScript tells apart": "FV0706",
    "a negative literal count for repeat, which throws": "FV0714",
    "toLocaleUpperCase, which depends on the server's locale": "FV0715",
    "a precision of 0 for toPrecision, which throws": "FV0716",
    "a precision that truncates to 0 for toPrecision": "FV0716",
    "a precision above 100 for toPrecision": "FV0716",
    "a precision for toPrecision that is not a literal": "FV0716",
    "more than 100 digits for toExponential": "FV0717",
    "a negative number of digits for toExponential": "FV0717",
    "a number of digits for toExponential that is not a literal": "FV0717",
    "replace with a regular expression": "FV0710",
    "a function that calls itself": "FV1906",
    "functions that call each other": "FV1906",
    "a function with a rest parameter": "FV1907",
    "a function given more arguments than it names": "FV1907",
    "an async function called by the template": "FV1907",
    "a function given spread arguments": "FV1907",
    "a default for a parameter given null or undefined": "FV1907",
    "a function with a while loop called by the template": "FV1901",
    "a function read as a value": "FV0613",
    "a for…in loop in a callback's body": "FV1901",
    "a while loop in a callback's body": "FV1901",
    "try in a callback's body": "FV1901",
    "throw in a callback's body": "FV1901",
    "var in a callback's body": "FV1901",
    "an expression statement in a callback's body": "FV1901",
    "a let of a body assigned from a callback inside it": "FV1902",
    "an assignment in a callback's body": "FV1902",
    "a callback that can end without a return": "FV1903",
    "a return without a value in a callback": "FV1903",
    "a const read before its declaration": "FV1901",
    "code after a return": "FV1904",
    "a case that falls through into the next": "FV1904",
    "a declaration directly in a case": "FV1904",
    "a body whose switches continue after them on too many paths": "FV1905",
    "a switch with no case for some values and nothing after it": "FV1903",
    "a function declared in a callback's body": "FV1901",
    "a computed that assigns a prop, read by the template": "FV1902",
    "a constant `Map` read by its size": "FV0227",
    "`&&` after an optional string, which may be empty": "FV0614",
    "`&&` after a choice that may be `null` or `undefined`": "FV0614",
    "a type imported from a component that is not compiled": "FV0512",
    "`<component :is>` choosing a child whose required prop is left out": "FV0506",
    "Object.entries pairs mapped to themselves": "FV0816",
    "Object.entries pairs joined": "FV0816",
    "Object.entries pairs sorted without a comparator": "FV0816",
    "a pair destructured with a default": "FV0808",
    "a pair read by a computed index": "FV0612",
    "a v-for over pairs with a nested array pattern": "FV0818",
    ".flat() with a depth that is not a literal": "FV0834",
    ".flat() of a list of optional lists": "FV0834",
    ".flatMap() whose function gives only []": "FV0834",
    ".flatMap() to lists of lists": "FV0834",
    "a computed list as a slot prop": "FV0910",
    "a component written with the Options API": "FV0003",
    "a template written in pug": "FV0008",
    "a template in another language than HTML": "FV0008",
    "a template read from another file": "FV0009",
    "a root input of a bound type with v-model": "FV0424",
    "a textarea given v-bind of an object": "FV0424",
    "an input with v-model given an attribute named at run time": "FV0424",
    "a textarea given a custom directive": "FV0424",
    "a root element with no content given a custom directive": "FV0425",
    "an element with no content given a custom directive and v-bind of an object": "FV0425",
    "an element with no content given a custom directive and a bound textContent": "FV0425",
    "an element with no content given a custom directive and a bound innerHTML": "FV0425",
    "an element with no content given a custom directive and v-bind of an object spread": "FV0425",
    "an element with no content given a custom directive and v-bind of a call": "FV0425",
    "an element with no content given a custom directive and an attribute named at run time": "FV0425",
    "a constructor called in the template": "FV0624",
    "Number.isNaN of a string, which it does not convert": "FV0718",
    "Number.isFinite of a date": "FV0718",
    "Number.isInteger without an argument": "FV0718",
    "the global isNaN of a string, which it converts": "FV0718",
    "the global isFinite of an optional number": "FV0718",
    "|| between a date and a string": "FV0617",
    "computed member access": "FV0612",
    "a list item read by a `Float` index": "FV0824",
    "a list item read by a string index": "FV0824",
    "a list item read by an optional index": "FV0824",
    "`.at()` of a list given a string": "FV0825",
    "`.at()` of a list given no index": "FV0825",
    "`.indexOf()` with a position to start from": "FV0826",
    "`.lastIndexOf()` of a value of another type than the list's": "FV0826",
    "`.indexOf()` of an object": "FV0826",
    "`.concat()` of a list of another item type": "FV0827",
    "`.concat()` of a value that is not a list": "FV0827",
    "`.reduce()` without an initial value": "FV0828",
    "`.reduceRight()` without an initial value": "FV0828",
    "`.reduce()` whose function changes the accumulator's type": "FV0829",
    "`.reduce()` into a list": "FV0829",
    "`.reduce()` given a function that is not an arrow function of the accumulator and the item": "FV0829",
    "`.reduce()` joining halves of surrogate pairs": "FV0706",
    "`.toSorted()` subtracting `Float` keys": "FV0830",
    "`.toSorted()` with a comparator that is not consistent": "FV0830",
    "`.toSorted()` with a comparator of another shape": "FV0830",
    "`.toSorted()` subtracting strings": "FV0830",
    "`.toSorted()` by `localeCompare`": "FV1805",
    "`.toSorted()` of objects without a comparator": "FV0831",
    "`.toSorted()` of strings that may hold halves of surrogate pairs": "FV0706",
    "`.sort()` of a prop in place": "FV0832",
    "`.reverse()` of a prop in place": "FV0832",
    "an array literal spreading lists of different item types": "FV0833",
    "an array literal spreading a string": "FV0833",
    "an array literal spreading objects beside a plain value": "FV0833",
    "`Math.max()` of a spread list of strings": "FV0704",
    "an optional call": "FV0629",
    "`??` after an optional chain that computes a list, falling back to another list": "FV0630",
    "a field read from a value that may be absent": "FV0604",
    "an optional chain into a method that is not supported": "FV0602",
    "the current time with new Date()": "FV1801",
    "the current time with Date.now()": "FV1801",
    "a date built from its parts in the local time zone": "FV1802",
    "a date built from a value that may be absent": "FV1802",
    "Date.parse of a number": "FV1802",
    "a date string read in the local time zone": "FV1803",
    "a date string outside the date time string format": "FV1803",
    "a date beyond the range whose offset brings it within": "FV1803",
    "a date read in the local time zone": "FV1804",
    "a date written by toString": "FV1804",
    "Date.UTC of no parts": "FV1807",
    "Date.UTC of a value that may be absent": "FV1807",
    "Date.UTC of a year engines compute differently": "FV1808",
    "two dates compared with ===": "FV1809",
    "a date compared with a string by ==": "FV1809",
    "a list of lists of dates": "FV1810",
    "a list of dates sorted without a comparator": "FV1804",
    "a date looked for in a list of dates": "FV0801",
    "a date ordered against a number": "FV0609",
    "JSON.stringify of a date that may be absent": "FV0707",
    "a number formatted by locale": "FV1805",
    "a date formatted by locale": "FV1805",
    "strings compared by locale": "FV1805",
    "an Intl formatter": "FV1805",
    "an Intl formatter called without new": "FV1805",
    "vue-i18n's number formatting": "FV1805",
    "a date interpolated whole": "FV0401",
    "a date bound to an attribute": "FV0403",
    "a CSS module without `cssModules` in the configuration": "FV1005",
    "v-bind() in a style block of a boolean": "FV1006",
    "v-bind() in a style block of a list": "FV1006",
    "a style property whose place would depend on a condition": "FV1011",
    "a dynamic component over any string": "FV0418",
    "a dynamic component over a value from elsewhere": "FV0418",
    "a dynamic component naming a custom element": "FV0419",
    "a dynamic component over an optional prop": "FV0420",
    "a dynamic component reading a key its object lacks": "FV0421",
    "v-html on a dynamic component": "FV0422",
    "a slot with fallback content inside a dynamic element": "FV0919",
    "v-show inside a dynamic element": "FV0423",
    "v-model on a select inside a dynamic element": "FV0423",
    "a ClientOnly fallback inside a dynamic element": "FV1511",
    "a class apart from a later :class inside a dynamic element": "FV1013",
    "a slot rendered inside a dynamic element and outside one": "FV0920",
    "a custom directive the configuration does not declare client-only": "FV0405",
    "a type that is both null and undefined": "FV0311",
    "a default for a nullable prop": "FV0307",
    "options given to useHead": "FV1701",
    "a head input that is not an object literal": "FV1702",
    "templateParams in the head": "FV1703",
    "a head key ferrovue does not translate": "FV1703",
    "a spread in a head input": "FV1704",
    "a titleTemplate function": "FV1705",
    "an event handler in the head": "FV1705",
    "a getter taking arguments in the head": "FV1705",
    "a head value of a list where one value goes": "FV1706",
    "a tagPosition that is not a literal": "FV1707",
    "useHeadSafe": "FV1708",
    "an object given to a useSeoMeta key": "FV1709",
    "a class in the head that may be null": "FV1710",
    "textContent on a meta tag": "FV1711",
  };

  const configs: Record<string, Partial<Config>> = {
    "a `unions` entry for an alias of integer literals": { unions: { Count: "crate::Count" } },
    "a `unions` entry for an alias of one literal": { unions: { Kind: "crate::Kind" } },
    "a `unions` entry for an alias of a union with `string`": { unions: { Size: "app_domain::Size" } },
    "a `unions` entry for a union another component declares with other members": { unions: { Pick: "crate::Pick" } },
  };

  const refusal = (project: string, config: Partial<Config> = {}): GenError => {
    try {
      generate(project, { ...CONFIG, ...config });
    } catch (e) {
      if (e instanceof GenError) return e;
      throw e;
    }
    throw new Error("compiled without an error");
  };

  it("names a code for every refusal it checks the code of", () => {
    expect(Object.keys(codes).filter((what) => !refused.some(([w]) => w === what))).toEqual([]);
    expect(Object.keys(configs).filter((what) => !refused.some(([w]) => w === what))).toEqual([]);
  });

  for (const [what, source, message] of refused) {
    it(`refuses ${what}`, () => {
      const e = refusal(island(source, children), configs[what]);
      expect(e.message).toMatch(message);
      expect(e.message).toMatch(/^components\/X\.vue:\d+:\d+: /);
      expect(Object.keys(ERRORS)).toContain(e.code);
      expect(e.at).toMatchObject({ file: "components/X.vue", line: Number(e.message.split(":")[1]), column: Number(e.message.split(":")[2]) });
      expect(e.code).toBe(codes[what] ?? e.code);
    });
  }
});

describe("refusals inside a computed or a function", () => {
  const refusals = (source: string, files: Record<string, string> = {}): GenError[] => {
    const root = island(source);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(root, "components", name), text);
    try {
      compile(root);
    } catch (e) {
      if (e instanceof GenErrors) return e.errors as GenError[];
      throw e;
    }
    throw new Error("compiled without an error");
  };

  it("carry the inner refusal's own code and place, said where it is, once however often the template reads it", () => {
    const [regex, literal, called, ...rest] = refusals(`<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ s: string }>();
const clean = computed(() => props.s.replace(/x|z/g, ""));
const shape = computed(() => ({ a: props.s }));
function pair(t: string): string {
  return [t, 1].join();
}
</script>
<template><i>{{ clean }}|{{ shape.a }}|{{ shape.a }}|{{ pair(s) }}</i></template>`);
    expect(rest).toEqual([]);
    expect(regex).toMatchObject({ code: "FV0710", at: { file: "components/X.vue", line: 4 } });
    expect(regex!.what).toMatch(/\(the template reads it as `clean` at components\/X\.vue:10:\d+\)$/);
    expect(literal).toMatchObject({ code: "FV0634", at: { file: "components/X.vue", line: 5 } });
    expect(literal!.what).toMatch(/^an object literal in a `computed` whose type is not known, .* \(the template reads it as `shape` at /);
    expect(called).toMatchObject({ code: "FV0611", at: { file: "components/X.vue", line: 7 } });
    expect(called!.what).toMatch(/\(in `pair\(\)`, called at components\/X\.vue:10:\d+\)$/);
  });

  it("names the tag resolved by name, and says which tuples are read", () => {
    const [tuple] = refusals(`<script setup lang="ts">\ndefineProps<{ at: [number, ...number[]] }>();\n</script>\n<template><i>{{ at }}</i></template>`);
    expect(tuple).toMatchObject({ code: "FV0316", help: expect.stringMatching(/declare an interface with a field for each part/) });
    const [tag] = refusals(`<template><rss><item>x</item></rss></template>`);
    expect(tag).toMatchObject({ code: "FV0513", what: expect.stringMatching(/^`<rss>` is a component the template resolves by name, which must be imported/) });
  });
});
