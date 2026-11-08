import { type Fn, type N } from "./model.ts";
import { resolveImport } from "./resolve.ts";
import { readTypeFile } from "./typescript.ts";
import { ctx } from "./context.ts";
import { type Declared } from "./const-decls.ts";

/** A name a `.ts` file exports: one of its own, by its local name, or one of another file's, by the
 * name that file exports it as (`null` for a module that is no `.ts` file of the project, or for a
 * namespace, `export * as ns from`). */
export type Export = { local: string } | { file: string | null; name: string | null };

/** What a `.ts` file exports: its names, and the files whose names `export * from` passes on. */
export interface Exports {
  names: Map<string, Export>;
  stars: (string | null)[];
}

/** The names a `.ts` file exports: by `export const`, `export function`, `export enum`,
 * `export { a, b as c }`, `export default a`, and from other files by `export { a } from` and `export * from`. */
export function exportsOf(rel: string, body: N[]): Exports {
  const names = new Map<string, Export>();
  const stars: (string | null)[] = [];
  const nameOf = (n: N): string => n.name ?? n.value;
  for (const st of body) {
    if (st.type === "ExportDefaultDeclaration") {
      const d = st.declaration;
      names.set("default", { local: d.type === "Identifier" ? d.name : "default" });
    }
    if (st.exportKind === "type") continue;
    if (st.type === "ExportAllDeclaration") {
      const file = resolveImport(rel, st.source.value);
      if (st.exported) names.set(nameOf(st.exported), { file: null, name: null });
      else stars.push(file);
    }
    if (st.type !== "ExportNamedDeclaration") continue;
    const d = st.declaration;
    if (d?.type === "VariableDeclaration") for (const v of d.declarations) if (v.id.type === "Identifier") names.set(v.id.name, { local: v.id.name });
    if (d?.id?.type === "Identifier") names.set(d.id.name, { local: d.id.name });
    if (d) continue;
    const from = st.source ? resolveImport(rel, st.source.value) : undefined;
    for (const sp of st.specifiers) {
      if (sp.exportKind === "type") continue;
      const as = nameOf(sp.exported);
      if (sp.type === "ExportNamespaceSpecifier") names.set(as, { file: null, name: null });
      else if (sp.type === "ExportSpecifier") names.set(as, from === undefined ? { local: sp.local.name } : { file: from, name: nameOf(sp.local) });
    }
  }
  return { names, stars };
}

/** The file and local name of what a `.ts` file exports as `name`, followed through `export … from`
 * and `export * from`; `undefined` when nothing is exported by that name, or two `export *` give it. */
function exportOrigin(file: string, name: string, seen: Set<string> = new Set()): { file: string; local: string } | undefined {
  const key = `${file}\0${name}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  readTypeFile(file);
  const exports = ctx.tsModules.get(file)?.exports;
  const e = exports?.names.get(name);
  if (e !== undefined) {
    if ("local" in e) return { file, local: e.local };
    return e.file === null || e.name === null ? undefined : exportOrigin(e.file, e.name, seen);
  }
  if (name === "default") return undefined;
  let found: { file: string; local: string } | undefined;
  for (const star of exports?.stars ?? []) {
    const o = star === null ? undefined : exportOrigin(star, name, new Set(seen));
    if (o === undefined) continue;
    if (found !== undefined && (found.file !== o.file || found.local !== o.local)) return undefined;
    found = o;
  }
  return found;
}

/** The constant or enum a `.ts` file exports as `name`. */
export function exportedConst(file: string, name: string): Declared | undefined {
  const o = exportOrigin(file, name);
  return o === undefined ? undefined : ctx.constDecls.get(o.file)?.get(o.local);
}

/** The function a `.ts` file exports as `name`. */
export function exportedFunction(file: string, name: string): Fn | undefined {
  const o = exportOrigin(file, name);
  return o === undefined ? undefined : ctx.tsModules.get(o.file)?.functions.get(o.local);
}
