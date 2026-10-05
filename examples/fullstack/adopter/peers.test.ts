import { expect, it } from "vitest";
import { renderToString } from "vue/server-renderer";
import { fixtureApp, readFixture } from "ferrovue/testing";
import routes from "../client/routes.json" with { type: "json" };
import BasketSummary from "../client/components/BasketSummary.vue";
import BookPage from "../client/components/BookPage.vue";

const basket = readFixture({ label: "Basket", $stores: { basket: { owner: "Ada", ids: ["dune", "solaris"] } } });
const book = readFixture({ book: { id: "dune", title: "Dune", author: "Frank Herbert", year: 1965 }, $route: "/books/dune" });

it("loads ferrovue/testing with Node, apart from the application's Pinia and vue-router", async () => {
  expect(import.meta.resolve("ferrovue/testing")).toMatch(/\/packages\/ferrovue\/dist\/testing\.js$/);
  await expect(fixtureApp(BasketSummary, basket, null).then(renderToString)).rejects.toThrow(/no active Pinia/);
});

it("renders a fixture's stores with the application's own Pinia", async () => {
  const html = await renderToString(await fixtureApp(BasketSummary, basket, null, { pinia: await import("pinia") }));
  expect(html).toMatch(/Basket of Ada: <b[^>]*>2<\/b> books/);
});

it("renders a fixture's route with the application's own vue-router", async () => {
  const html = await renderToString(await fixtureApp(BookPage, book, routes, { vueRouter: await import("vue-router") }));
  expect(html).toContain('data-id="dune"');
  expect(html).toContain("<code>/books/dune</code>");
});
