import { parseJson } from "./page-json.ts";

export const LOADS_ATTRIBUTE = "data-fv-loads";

interface LoadStore {
  results: Map<string, unknown>;
  scanned: Document | null;
  running: Set<Promise<unknown>>;
}

const LOADS = Symbol.for("ferrovue.loads");

function loadStore(): LoadStore {
  const global = globalThis as { [LOADS]?: LoadStore };
  return (global[LOADS] ??= { results: new Map(), scanned: null, running: new Set() });
}

function scanLoads(store: LoadStore): void {
  if (typeof document === "undefined" || store.scanned === document) return;
  store.scanned = document;
  for (const el of document.querySelectorAll(`script[${LOADS_ATTRIBUTE}]`)) if (el.textContent) provideLoads(el.textContent);
}

/** The key of a loader's call, which the server writes each result under: `JSON.stringify` of the
 * loader's name and its arguments, without the arguments left out at the end (or given as
 * `undefined` there), so that `loadPost(1)` and `loadPost(1, undefined)` are one call, as they are
 * to the loader. */
export function loadKey(name: string, args: readonly unknown[]): string {
  let given = args.length;
  while (given > 0 && args[given - 1] === undefined) given--;
  return JSON.stringify([name, ...args.slice(0, given)]);
}

/** A function a component awaits in `<script setup>` for its data (`const post = await
 * loadPost(props.id)`), which the server renders from what the Rust app's loader of the same name
 * returns. In the browser, a call whose key (`loadKey`) is among the results the page carries
 * (`Loads::script_into`, read once from the document's `<script data-fv-loads>`, or given to
 * `provideLoads`) resolves to that result, so that the component hydrates from what the server
 * rendered; any other call runs `loader`. `name` is the Rust app's name for it, unique in the project:
 * the compiler reads the declaration, `export const loadPost = defineLoader("loadPost", async (id:
 * number): Promise<Post> => …)`, for the types of the arguments and the result. */
export function defineLoader<A extends unknown[], T>(name: string, loader: (...args: A) => Promise<T>): (...args: A) => Promise<T> {
  return (...args: A): Promise<T> => {
    const store = loadStore();
    scanLoads(store);
    const key = loadKey(name, args);
    if (store.results.has(key)) return Promise.resolve(store.results.get(key) as T);
    const running = loader(...args);
    store.running.add(running);
    const done = () => store.running.delete(running);
    running.then(done, done);
    return running;
  };
}

/** Add results for loaders to answer from: the text of a `<script data-fv-loads>`, as `readPage`
 * gives it for the next page of a navigation, or an object of keys and results. A key given again
 * takes its newer result. */
export function provideLoads(results: string | Record<string, unknown>): void {
  const store = loadStore();
  const given = typeof results === "string" ? (parseJson(results) as Record<string, unknown>) : results;
  for (const [key, value] of Object.entries(given)) store.results.set(key, value);
}

/** Forget every result given so far, and read the document's scripts again on the next call: a
 * test rendering one fixture after another starts each from its own. */
export function clearLoads(): void {
  const store = loadStore();
  store.results.clear();
  store.scanned = null;
}

/** Whether the page carries results for loaders, so that its components await them and hydrate
 * inside a `<Suspense>`. */
export function carriesLoads(): boolean {
  const store = loadStore();
  scanLoads(store);
  return store.results.size > 0 || (typeof document !== "undefined" && document.querySelector(`script[${LOADS_ATTRIBUTE}]`) !== null);
}

/** Wait until every call of a loader running now, and every one those lead to, has finished. */
export async function loadsSettled(): Promise<void> {
  const store = loadStore();
  for (let round = 0; round < 20 && store.running.size > 0; round++) {
    await Promise.allSettled(store.running);
    await new Promise((done) => setTimeout(done, 0));
  }
}
