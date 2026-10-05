import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createMemoryHistory, RouterLink, useRoute } from "vue-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { linkRouter, type LinkRouterOptions, type RouteEntry } from "../src/link-router.ts";

type Navigate = LinkRouterOptions["navigate"];

const ROUTES: RouteEntry[] = ["/", { path: "/users/:name", name: "user" }, { path: "/account", name: "account", children: [{ path: "orders", name: "orders" }] }];

const Nav = defineComponent({
  setup() {
    const route = useRoute();
    return () =>
      h("nav", [
        h(RouterLink, { to: "/" }, () => "home"),
        h(RouterLink, { to: { name: "user", params: { name: "ada" } } }, () => "ada"),
        h(RouterLink, { to: "/account" }, () => "account"),
        h(RouterLink, { to: "/account/orders" }, () => "orders"),
        h("p", route.fullPath),
      ]);
  },
});

const setUrl = (url: string) => (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);

const warnings: unknown[][] = [];
beforeEach(() => {
  warnings.length = 0;
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => void warnings.push(args));
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function atLocation(location: string, base?: string) {
  const history = createMemoryHistory(base);
  history.replace(location);
  return history;
}

it("lets the first navigation through and hands every later one to navigate, staying where it started", async () => {
  const navigate = vi.fn<Navigate>();
  const router = linkRouter(ROUTES, { navigate, history: atLocation("/users/ada") });
  await router.push("/users/ada");
  expect(router.currentRoute.value.fullPath).toBe("/users/ada");
  expect(navigate).not.toHaveBeenCalled();

  const failure = await router.push("/account/orders?page=2#top");
  expect(failure).toBeTruthy();
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate.mock.calls[0]![0]).toBe("/account/orders?page=2#top");
  expect(navigate.mock.calls[0]![1].name).toBe("orders");
  expect(router.currentRoute.value.fullPath).toBe("/users/ada");
  expect(router.options.history.location).toBe("/users/ada");

  await router.replace({ name: "user", params: { name: "grace" } });
  expect(navigate.mock.calls[1]![0]).toBe("/users/grace");
  expect(router.currentRoute.value.fullPath).toBe("/users/ada");
});

it("hands a navigation to the page already shown to navigate too", async () => {
  const navigate = vi.fn<Navigate>();
  const router = linkRouter(ROUTES, { navigate, history: atLocation("/") });
  await router.push("/");
  await router.push("/");
  expect(navigate).toHaveBeenCalledWith("/", expect.objectContaining({ fullPath: "/" }));
});

it("starts from the page's location without the base, and hands navigate the href with it", async () => {
  setUrl("http://link-router.test/app/users/ada?tab=posts#latest");
  const navigate = vi.fn<Navigate>();
  const router = linkRouter(ROUTES, { navigate, base: "/app/" });
  await router.push(router.options.history.location);
  expect(router.currentRoute.value.fullPath).toBe("/users/ada?tab=posts#latest");
  expect(router.currentRoute.value.params).toEqual({ name: "ada" });
  await router.push("/account");
  expect(navigate).toHaveBeenCalledWith("/app/account", expect.objectContaining({ fullPath: "/account" }));
  expect(window.location.href).toBe("http://link-router.test/app/users/ada?tab=posts#latest");
});

it("marks the active links of a hydrated page and leaves a click to navigate", async () => {
  const serverRouter = linkRouter(ROUTES, { navigate: () => {}, history: atLocation("/account/orders") });
  const server = createSSRApp(Nav).use(serverRouter);
  await serverRouter.push("/account/orders");
  const html = await renderToString(server);

  setUrl("http://link-router.test/account/orders");
  document.body.innerHTML = `<div id="app">${html}</div>`;
  const clicks: boolean[] = [];
  document.addEventListener("click", (e) => clicks.push(e.defaultPrevented));
  const navigate = vi.fn<Navigate>();
  const router = linkRouter(ROUTES, { navigate });
  const app = createSSRApp(Nav).use(router);
  await router.isReady();
  app.mount("#app");

  const [home, ada, account, orders] = Array.from(document.querySelectorAll("a"));
  expect(orders!.className).toBe("router-link-active router-link-exact-active");
  expect(orders!.getAttribute("aria-current")).toBe("page");
  expect(account!.className).toBe("router-link-active");
  expect(account!.hasAttribute("aria-current")).toBe(false);
  expect(home!.className).toBe("");
  expect(ada!.getAttribute("href")).toBe("/users/ada");
  expect(document.querySelector("p")!.textContent).toBe("/account/orders");

  ada!.click();
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/users/ada", expect.objectContaining({ name: "user" })));
  expect(clicks).toEqual([true]);
  expect(router.currentRoute.value.fullPath).toBe("/account/orders");
  expect(window.location.pathname).toBe("/account/orders");
  expect(orders!.className).toBe("router-link-active router-link-exact-active");
  expect(warnings.filter((w) => String(w[0]).includes("Hydration"))).toEqual([]);
  app.unmount();
});
