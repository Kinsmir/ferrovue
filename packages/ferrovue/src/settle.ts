import { nextTick, type App, type VNode } from "vue";

interface AsyncWrapper {
  __asyncLoader?: () => Promise<unknown>;
  __asyncResolved?: unknown;
}

function loading(vnode: VNode | null | undefined, found: Promise<unknown>[]): void {
  if (!vnode || typeof vnode !== "object") return;
  const type = vnode.type as AsyncWrapper;
  if (type.__asyncLoader && !type.__asyncResolved) found.push(type.__asyncLoader());
  if (vnode.component) loading(vnode.component.subTree, found);
  if (Array.isArray(vnode.children)) for (const child of vnode.children) loading(child as VNode, found);
}

function loaders(app: App): Promise<unknown>[] {
  const found: Promise<unknown>[] = [];
  loading(app._instance?.subTree, found);
  return found;
}

/** Whether the app shows an async component that has not loaded yet. */
export function stillLoading(app: App): boolean {
  return loaders(app).length > 0;
}

/** Wait until every async component the app shows has loaded, been hydrated or rendered, and every
 * update this caused has been flushed. */
export async function settled(app: App): Promise<void> {
  for (let round = 0; round < 20; round++) {
    const found = loaders(app);
    await Promise.all(found);
    await nextTick();
    if (!found.length) return;
  }
  throw new Error("async components were still loading after 20 rounds");
}
