/* `types.rs`: the types components import from shared `.ts` files, which the core reads
 * (`readTypeFile`), written once beside the components. The core's own module, written through the
 * plugin hook so that it takes its place among the plugins' modules. */

import { ctx } from "../context.ts";
import { typesSource } from "../rust.ts";
import { type Plugin } from "../plugin.ts";

export const sharedTypes: Plugin = {
  name: "types",
  modules: () => (ctx.typeStructs.size ? [["types.rs", typesSource()]] : []),
};
