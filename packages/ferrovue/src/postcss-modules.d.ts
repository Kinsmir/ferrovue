declare module "postcss-modules-values" {
  import type { PluginCreator } from "postcss";
  const values: PluginCreator<unknown>;
  export default values;
}

declare module "postcss-modules-local-by-default" {
  import type { PluginCreator } from "postcss";
  const localByDefault: PluginCreator<{ mode: "local" | "global" | "pure" }>;
  export default localByDefault;
}

declare module "postcss-modules-extract-imports" {
  import type { PluginCreator } from "postcss";
  const extractImports: PluginCreator<unknown>;
  export default extractImports;
}

declare module "postcss-modules-scope" {
  import type { PluginCreator } from "postcss";
  const scope: PluginCreator<{ generateScopedName: (local: string, file: string) => string; exportGlobals: boolean }>;
  export default scope;
}

declare module "generic-names" {
  function genericNames(pattern: string, options: { context: string; hashPrefix: string }): (local: string, file: string) => string;
  export default genericNames;
}
