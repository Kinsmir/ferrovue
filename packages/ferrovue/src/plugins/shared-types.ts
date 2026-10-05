import { ctx } from "../context.ts";
import { typesSource } from "../rust.ts";
import { type Plugin } from "../plugin.ts";

export const sharedTypes: Plugin = {
  name: "types",
  modules: () => (ctx.typeStructs.size ? [["types.rs", typesSource()]] : []),
};
