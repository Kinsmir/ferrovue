import { renderToString } from "@vue/server-renderer";
import { format } from "oxfmt";
import * as Vue from "vue";
import { describe, expect, it } from "vitest";
import { trimEdges } from "../src/whitespace.ts";

const html = async (template: string, transforms: (typeof trimEdges)[]): Promise<string> => {
  const render = Vue.compile(template, { whitespace: "condense", comments: false, nodeTransforms: transforms });
  return renderToString(Vue.createSSRApp({ render, data: () => ({ ok: true, name: "alice", items: ["a", "b"] }) }));
};

const formatted = async (template: string, printWidth: number): Promise<string> => {
  const { code, errors } = await format("a.vue", `<template>\n${template}\n</template>\n`, { printWidth });
  expect(errors).toEqual([]);
  return /<template>\n([\s\S]*)\n<\/template>/.exec(code)![1]!;
};

const TEMPLATES = [
  "<p>ago<span> by a long name that wraps </span>alice and some more words</p>",
  '<p><span v-if="ok"> · <button>this device with a long label</button></span></p>',
  "<p>submitted <time>an hour ago</time> <span>by</span> <a>{{ name }}</a> <b>and</b> <i>more words</i></p>",
  "<p><button>remove this thing from the list</button> <a>undo the last change</a></p>",
  '<div><span>by</span> <template v-if="ok"><a>{{ name }}</a> <b>tag</b></template> <em>and more words here</em></div>',
  '<ul><li v-for="i in items" :key="i"><span>{{ i }}</span> <small>a long note on the item</small></li></ul>',
  "<span>a long first span of text</span> <a>a second inline element at the root</a>",
  "<p><label>name of the long field <input></label> <select><option>one</option></select> <code>x</code></p>",
];

describe("trimEdges with a formatter", () => {
  for (const printWidth of [20, 40, 80]) {
    it(`renders an oxfmt-formatted template at print width ${printWidth} as Vue renders it typed on one line`, async () => {
      for (const template of TEMPLATES) {
        const source = await formatted(template, printWidth);
        expect(await html(source, [trimEdges]), source).toBe(await html(template, []));
      }
    });
  }
});
