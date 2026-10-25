export const LOADS_ATTRIBUTE = "data-fv-loads";

export interface LoadStore {
  results: Map<string, unknown>;
  scanned: WeakSet<Element>;
  running: Set<Promise<unknown>>;
}

const LOADS = Symbol.for("ferrovue.loads");

export function loadStore(): LoadStore {
  const global = globalThis as { [LOADS]?: LoadStore };
  return (global[LOADS] ??= { results: new Map(), scanned: new WeakSet(), running: new Set() });
}

/** Wait until every call of a loader running now, and every one those lead to, has finished. */
export async function loadsSettled(): Promise<void> {
  const store = loadStore();
  for (let round = 0; round < 20 && store.running.size > 0; round++) {
    await Promise.allSettled(store.running);
    await new Promise((done) => setTimeout(done, 0));
  }
}
