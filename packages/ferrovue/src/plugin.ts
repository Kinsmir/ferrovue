import type { SFCDescriptor } from "@vue/compiler-sfc";
import { type Component, type N, type Scope, type Struct, type StructTy, type Ty, type Val } from "./model.ts";
import { type Config, ctx } from "./context.ts";
import { type Emitter } from "./emitter.ts";
import type { Presence } from "./narrowing.ts";

export interface RenderParam {
  name: string;
  ty: string;
  pageTy: string;
  reads(comp: Component): boolean;
  test: { lines: string[]; arg: string; fixture?: boolean; after?: string[] };
  fixtureField?: string;
  fixtureDefault?: string;
  testSupport?: string;
  slotContext?: string;
}

export interface SlotField {
  js: string;
  rust: string;
  doc: string;
}

export interface ValueHooks {
  describe?(ty: Ty): string | undefined;
  truthy?(v: Val): string | undefined;
  interpolate?(e: Emitter, v: Val): boolean;
  unbindable?(ty: Ty): { what: string; fix: string } | undefined;
  nullish?(s: Scope, a: Val, b: Val, n: N): Val | undefined;
  equals?(a: Val, b: Val): string | undefined;
  isArray?(v: Val): Val | undefined;
}

export interface ReadComponent {
  comp: Component;
  ssr: string;
  children: Map<string, string>;
  attrsBindings: Set<string>;
}

export interface Plugin<Run = unknown, Local = unknown> {
  name: string;

  configure?(config: Config, root: string): Run;
  prepare?(root: string): void;
  components?(): { file: string; name: string }[];

  sfc?(comp: Component, descriptor: SFCDescriptor, file: string, source: string): void;
  templateOptions?(comp: Component): { id: string; scoped: boolean; slotted: boolean };
  importedType?(comp: Component, file: string, name: string, local: string): boolean;
  struct?(ty: StructTy): { st: Struct | undefined; module: string } | null;
  compiled?(comp: Component, code: string, script: N[]): void;
  analyse?(read: ReadComponent[]): void;

  scope?(s: Scope): Local;
  scriptImport?(s: Scope, st: N, from: string): boolean;
  scriptBinding?(s: Scope, d: N, lets: string[]): boolean;
  scriptStatement?(s: Scope, st: N): boolean;
  prelude?(s: Scope): { before: string[]; after: string[] };

  global?(s: Scope, name: string, n: N): Val | null;
  call?(s: Scope, n: N): Val | null;
  member?(s: Scope, base: Val, prop: string, n: N, computed: boolean): Val | null;
  equality?(s: Scope, n: N): Val | null;
  presence?(s: Scope, n: N): Presence | null | undefined;
  values?: ValueHooks;

  resolveComponent?(s: Scope, local: string, name: string): boolean;
  component?(s: Scope, e: Emitter, n: N): boolean;
  child?(s: Scope, child: Component, n: N): void;
  childIds?(s: Scope, child: Component, passesAttrs: boolean, inSlot: boolean, n: N): string | null;
  loadedLater?(child: Component): string[];
  statement?(s: Scope, e: Emitter, call: N, st: N): boolean;

  params?: RenderParam[];
  slotFields?(comp: Component): SlotField[];
  modules?(): [string, string][];
}

export function runOf<Run>(plugin: Plugin<Run>): Run {
  return ctx.runs.get(plugin) as Run;
}

export function scopeOf<Local>(plugin: Plugin<unknown, Local>, s: Scope): Local {
  return s.plugins.get(plugin) as Local;
}

export function claim<T>(ask: (p: Plugin) => T | null | undefined): T | undefined {
  for (const p of ctx.plugins) {
    const answer = ask(p);
    if (answer !== null && answer !== undefined) return answer;
  }
  return undefined;
}

export function renderParams(): RenderParam[] {
  return ctx.plugins.flatMap((p) => p.params ?? []);
}

export function paramsOf(comp: Component): RenderParam[] {
  return renderParams().filter((p) => comp.takes.has(p.name));
}

export function slotContextOf(comp: Component): RenderParam[] {
  return paramsOf(comp).filter((p) => p.slotContext !== undefined);
}

export function slotFieldsOf(comp: Component): SlotField[] {
  return ctx.plugins.flatMap((p) => p.slotFields?.(comp) ?? []);
}
