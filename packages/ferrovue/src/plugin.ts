/* Compiler plugins: what an integration adds to the core compiler, through a few defined hooks.
 *
 * The core translates Vue's compiled template and `<script setup>` on their own. An integration —
 * vue-router, Pinia, vue-i18n, scoped styles — is a `Plugin`: an object of optional hooks, listed in
 * `plugins/index.ts`, which the core calls at fixed points of a run without knowing which plugins
 * there are. A new integration (page head, provide/inject, file-based routes) is a new file beside
 * the others, not a change inside the core.
 *
 * A plugin keeps no state of its own between runs: what it reads for one run lives in the run
 * context (`ctx`), where `configure` puts it and `runOf` finds it; what it reads of one component's
 * setup lives in that component's `Scope`, where `scope` puts it and `scopeOf` finds it.
 *
 * Hooks that may claim something — a node, an import — are asked in the plugins' order, and the first
 * to claim it decides: they answer `null` (or `false`) for what is not theirs. The plugins' order is
 * part of the generated code as well: it is the order of a render's parameters, of the fixture's
 * fields, and of the modules written beside the components. */

import type { SFCDescriptor } from "@vue/compiler-sfc";
import { type Component, type N, type Scope, type Struct, type StructTy, type Ty, type Val } from "./model.ts";
import { type Config, ctx } from "./context.ts";
import { type Emitter } from "./emitter.ts";
import { type Presence } from "./expr.ts";

/** A value a render takes from its caller beyond the props and the slots — the route, the stores'
 * state, the request's translations — which a component takes when it reads it or renders a child
 * that does. */
export interface RenderParam {
  /** Its name in the generated code: `fv_route`. */
  name: string;
  /** Its type in `render`, and in `html`, which names the page's lifetime `'p`. */
  ty: string;
  pageTy: string;
  /** Whether a component reads it itself, which is known once every component's setup is read. */
  reads(comp: Component): boolean;
  /** How the conformance suite's `render_json` builds it: the statements, and the argument they
   * leave for the render. `fixture` when they read the fixture beyond the props; `after`, what
   * follows the render. */
  test: { lines: string[]; arg: string; fixture?: boolean; after?: string[] };
  /** The fixture's field it is read from, with its `serde` attribute, and the default's function. */
  fixtureField?: string;
  fixtureDefault?: string;
  /** Test-only code `mod.rs` holds once some component takes it. */
  testSupport?: string;
}

/** A field of a component's `Slots` that its caller always fills, beyond the slots it renders:
 * `router_view`, the page `<RouterView>` shows. */
export interface SlotField {
  /** The name a fixture's `$slots` gives its content. */
  js: string;
  /** The field. */
  rust: string;
  /** Its documentation, one line. */
  doc: string;
}

/** What the core does with values of a type a plugin adds (`PluginTys` in `model.ts`): each hook
 * answers for that plugin's types alone, and `undefined` for any other. */
export interface ValueHooks {
  /** The type, as an error names it: "a query value". */
  describe?(ty: Ty): string | undefined;
  /** Its truthiness, as a Rust boolean. */
  truthy?(v: Val): string | undefined;
  /** `{{ v }}`: written escaped into `e`, `true` when it is the plugin's. */
  interpolate?(e: Emitter, v: Val): boolean;
  /** Why an attribute may not be bound to it, and what to bind instead. */
  unbindable?(ty: Ty): { what: string; fix: string } | undefined;
  /** `a ?? b`, both translated. */
  nullish?(s: Scope, a: Val, b: Val, n: N): Val | undefined;
  /** `a === b` as a Rust boolean, both translated. */
  equals?(a: Val, b: Val): string | undefined;
  /** `Array.isArray(v)`. */
  isArray?(v: Val): Val | undefined;
}

/** A component as \`analyse\` sees it: its compiled template, the child components its setup
 * imports by local name, and the setup bindings that hold \`useAttrs()\`. */
export interface ReadComponent {
  comp: Component;
  ssr: string;
  children: Map<string, string>;
  attrsBindings: Set<string>;
}

export interface Plugin<Run = unknown, Local = unknown> {
  name: string;

  // The run.
  /** Its state for one run, from the configuration: called by `generate` before anything is read. */
  configure?(config: Config, root: string): Run;
  /** Files it reads with the core's own readers (TypeScript), once every plugin is configured. */
  prepare?(root: string): void;

  // Reading a component.
  /** A component's single-file descriptor, before its template is compiled: its \`<style>\` blocks. */
  sfc?(comp: Component, descriptor: SFCDescriptor, file: string, source: string): void;
  /** How Vue compiles the component's template, where the plugin decides it: its scope id. */
  templateOptions?(comp: Component): { id: string; scoped: boolean; slotted: boolean };
  /** A type a component imports from a `.ts` file the plugin owns (a store's): recorded in
   * `comp.importedTypes`, `true` when the file is the plugin's. */
  importedType?(comp: Component, file: string, name: string, local: string): boolean;
  /** Where a struct type of the plugin's is declared — its fields, and the generated module it is
   * written to — or `null` for any other. */
  struct?(ty: StructTy): { st: Struct | undefined; module: string } | null;
  /** Vue's SSR compilation of a component's template, and the statements of its script blocks:
   * what it renders or reads, found before any component is generated. */
  compiled?(comp: Component, code: string, script: N[]): void;
  /** Every component of the run at once, each set up and compiled: for what reaches from one
   * component to another (whose roots may be handed scope ids), before any is generated. */
  analyse?(read: ReadComponent[]): void;

  // `<script setup>`.
  /** Its state for one component's setup scope — the names the setup bound to what the plugin
   * provides — shared by every copy of the scope. */
  scope?(s: Scope): Local;
  /** An import from a module the plugin owns (`vue-router`, a store's file): read into its scope
   * state, `true` when it is the plugin's. */
  scriptImport?(s: Scope, st: N, from: string): boolean;
  /** A setup declaration: `const route = useRoute()`. `true` when it is the plugin's. */
  scriptBinding?(s: Scope, d: N): boolean;

  // Expressions.
  /** `_ctx.<name>` in the compiled template: a global the plugin provides (`$route`), or `null`. */
  global?(s: Scope, name: string, n: N): Val | null;
  /** A call the core's own functions are not (`$t(…)`), or `null`. */
  call?(s: Scope, n: N): Val | null;
  /** `base.prop` — `base["prop"]` when `computed` — where `base` is a value of the plugin's: a
   * field of the route, a store's getter. `null` when it is not one. */
  member?(s: Scope, base: Val, prop: string, n: N, computed: boolean): Val | null;
  /** `a === b` or `a !== b` it translates whole, before its sides are: `typeof x === "string"`. */
  equality?(s: Scope, n: N): Val | null;
  /** A test it narrows on: the presence it tests, `null` for a test of its own that narrows
   * nothing, `undefined` for any other. */
  presence?(s: Scope, n: N): Presence | null | undefined;
  values?: ValueHooks;

  // The compiled template.
  /** `const _component_X = _resolveComponent("X")`: a component the plugin provides by name. */
  resolveComponent?(s: Scope, local: string, name: string): boolean;
  /** `_ssrRenderComponent(…)` of a component the plugin renders itself (`<RouterLink>`). */
  component?(s: Scope, e: Emitter, n: N): boolean;
  /** A child component this one renders: refused here when the plugin cannot have it there. */
  child?(s: Scope, child: Component, n: N): void;
  /** The ids a child's root is handed, as a Rust \`&str\` — \`null\` for none — given whether this
   * component passes its own \`_attrs\` on to it and whether it is rendered in slot content. One
   * plugin gives them: scoped styles. */
  childIds?(s: Scope, child: Component, passesAttrs: boolean, inSlot: boolean, n: N): string | null;
  /** A statement of the compiled template that calls a helper the core does not translate
   * (`_ssrRenderTeleport(…)`): written into `e`, `true` when it is the plugin's. */
  statement?(s: Scope, e: Emitter, call: N, st: N): boolean;

  // The Rust written.
  /** What it adds to a render's parameters, in this order. */
  params?: RenderParam[];
  /** The slots it fills for a component, whatever the template renders. */
  slotFields?(comp: Component): SlotField[];
  /** The Rust modules it writes beside the components, file name → source, once every component is
   * generated. */
  modules?(): [string, string][];
}

/** A plugin's state for the run in progress. */
export function runOf<Run>(plugin: Plugin<Run>): Run {
  return ctx.runs.get(plugin) as Run;
}

/** A plugin's state for the setup scope `s` belongs to. */
export function scopeOf<Local>(plugin: Plugin<unknown, Local>, s: Scope): Local {
  return s.plugins.get(plugin) as Local;
}

/** The first answer a plugin gives that is not `null` or `undefined`: what claims `ask`. */
export function claim<T>(ask: (p: Plugin) => T | null | undefined): T | undefined {
  for (const p of ctx.plugins) {
    const answer = ask(p);
    if (answer !== null && answer !== undefined) return answer;
  }
  return undefined;
}

/** Every render parameter the plugins add, in order. */
export function renderParams(): RenderParam[] {
  return ctx.plugins.flatMap((p) => p.params ?? []);
}

/** The render parameters a component takes, in order. */
export function paramsOf(comp: Component): RenderParam[] {
  return renderParams().filter((p) => comp.takes.has(p.name));
}

/** The slots the plugins fill for a component, beyond those its template renders. */
export function slotFieldsOf(comp: Component): SlotField[] {
  return ctx.plugins.flatMap((p) => p.slotFields?.(comp) ?? []);
}
