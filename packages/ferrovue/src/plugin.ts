/* Compiler plugins: what an integration adds to the core compiler, through a few defined hooks.
 *
 * The core translates Vue's compiled template and `<script setup>` on their own. An integration —
 * vue-router, Pinia, vue-i18n, scoped styles — is a `Plugin`: an object of optional hooks, listed in
 * `plugins/index.ts`, which the core calls at fixed points of a run without knowing which plugins
 * there are. A new integration (page head, provide/inject, file-based routes) is a new file beside
 * the others, not a change inside the core.
 *
 * A plugin keeps no state of its own between runs: what it reads for one run lives in the run
 * context (`ctx`), where `configure` puts it and `runOf` finds it.
 *
 * The plugins' order is part of the generated code: it is the order of a render's parameters, of
 * the fixture's fields, and of the modules written beside the components. */

import { type Component, type N, type Scope } from "./model.ts";
import { type Config, ctx } from "./context.ts";
import { type Emitter } from "./emitter.ts";

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

export interface Plugin<Run = unknown> {
  name: string;

  // The run.
  /** Its state for one run, from the configuration: called by `generate` before anything is read. */
  configure?(config: Config, root: string): Run;
  /** Files it reads with the core's own readers (TypeScript), once every plugin is configured. */
  prepare?(root: string): void;

  // Reading a component.
  /** Vue's SSR compilation of a component's template, and the statements of its script blocks:
   * what it renders or reads, found before any component is generated. */
  compiled?(comp: Component, code: string, script: N[]): void;

  // The compiled template.
  /** A statement of the compiled template that calls a helper the core does not translate
   * (`_ssrRenderTeleport(…)`): written into `e`, `true` when it is the plugin's. */
  statement?(s: Scope, e: Emitter, call: N, st: N): boolean;

  // The Rust written.
  /** What it adds to a render's parameters, in this order. */
  params?: RenderParam[];
  /** The Rust modules it writes beside the components, file name → source, once every component is
   * generated. */
  modules?(): [string, string][];
}

/** A plugin's state for the run in progress. */
export function runOf<Run>(plugin: Plugin<Run>): Run {
  return ctx.runs.get(plugin) as Run;
}

/** Every render parameter the plugins add, in order. */
export function renderParams(): RenderParam[] {
  return ctx.plugins.flatMap((p) => p.params ?? []);
}

/** The render parameters a component takes, in order. */
export function paramsOf(comp: Component): RenderParam[] {
  return renderParams().filter((p) => comp.takes.has(p.name));
}
