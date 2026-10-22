import { ctx } from "../context.ts";
import { hasEnums } from "../enums.ts";
import { typesSource } from "../rust.ts";
import { typeWritten } from "../typescript.ts";
import { type Plugin } from "../plugin.ts";

export const sharedTypes: Plugin = {
  name: "types",
  modules: () => ([...ctx.typeStructs.keys()].some(typeWritten) || ctx.typeConsts.size || hasEnums("types") ? [["types.rs", typesSource()]] : []),
};
