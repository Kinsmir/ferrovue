import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox, webkit, type Browser, type ConsoleMessage, type Page } from "playwright";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = join(import.meta.dirname, "..");
const LAUNCHERS = { chromium, firefox, webkit };
const BROWSERS = (process.env.FERROVUE_BROWSERS ?? "chromium,firefox,webkit").split(",") as (keyof typeof LAUNCHERS)[];

let dist = "";
let server: ChildProcess | undefined;
let origin = "";

function buildServer(): string {
  const out = execFileSync("cargo", ["build", "--locked", "--message-format=json", "-p", "ferrovue-example-fullstack"], {
    cwd: HERE,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
  for (const line of out.split("\n")) {
    const message = JSON.parse(line || "{}") as { reason?: string; executable?: string | null; target?: { name: string } };
    if (message.reason === "compiler-artifact" && message.target?.name === "ferrovue-example-fullstack" && message.executable) return message.executable;
  }
  throw new Error("cargo built no ferrovue-example-fullstack binary");
}

function startServer(binary: string): Promise<string> {
  return new Promise((resolve, reject) => {
    server = spawn(binary, [], { env: { ...process.env, PORT: "0", DIST_DIR: dist }, stdio: ["ignore", "pipe", "inherit"] });
    server.once("error", reject);
    server.once("exit", (code) => reject(new Error(`the server exited (${code}) before it listened`)));
    let out = "";
    server.stdout!.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const listening = /listening on (http:\/\/\S+)/.exec(out);
      if (listening) resolve(listening[1]!);
    });
  });
}

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), "ferrovue-fullstack-"));
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  await build({
    configFile: join(HERE, "vite.config.ts"),
    root: HERE,
    logLevel: "warn",
    define: { __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "true" },
    build: { outDir: dist },
  }).finally(() => {
    process.env.NODE_ENV = nodeEnv;
  });
  origin = await startServer(buildServer());
});

afterAll(() => {
  server?.kill();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

async function describeMessage(m: ConsoleMessage): Promise<string> {
  const args = await Promise.all(
    m.args().map((a) =>
      a.evaluate((v) => (v instanceof Element ? v.outerHTML.slice(0, 200) : v instanceof Node ? JSON.stringify(v.textContent) : String(v))),
    ),
  ).catch(() => [m.text()]);
  return `${m.type()}: ${args.join(" ")}`;
}

describe.each(BROWSERS)("%s", (name) => {
  let browser: Browser | undefined;
  let page: Page;
  let messages: Promise<string>[] = [];
  let scripts: string[] = [];
  beforeAll(async () => {
    try {
      browser = await LAUNCHERS[name].launch();
    } catch (e) {
      if (process.env.CI) throw e;
      console.warn(`${name} does not launch here, so its tests are skipped:`, String(e).split("\n")[0]);
      return;
    }
    page = await browser.newPage();
    page.on("console", (m) => {
      if ((m.type() === "warning" || m.type() === "error") && m.location().url.startsWith(origin)) messages.push(describeMessage(m));
    });
    page.on("pageerror", (e) => void messages.push(Promise.resolve(`uncaught: ${e.message}`)));
    page.on("request", (r) => {
      if (r.resourceType() === "script") scripts.push(new URL(r.url()).pathname);
    });
    await page.route(`${origin}/**`, async (route) => {
      if (route.request().resourceType() !== "document") return route.continue();
      const response = await route.fetch();
      const snapshot = "<script>document.currentScript.remove(); window.parsed = document.body.innerHTML; window.parsedHead = document.head.innerHTML;</script>";
      return route.fulfill({ response, body: (await response.text()).replace('<script type="module"', `${snapshot}$&`) });
    });
  });
  afterAll(async () => {
    await browser?.close();
  });

  async function open(path: string): Promise<void> {
    messages = [];
    scripts = [];
    await page.goto(`${origin}${path}`);
    await page.waitForFunction(() =>
      [...document.querySelectorAll("[data-island]:not([data-hydrate]), #basket, #app")].every((el) => (el as { _vnode?: unknown })._vnode),
    );
  }

  const hydrated = (selector: string): Promise<boolean> =>
    page.locator(selector).evaluate((el) => Boolean((el.closest("[data-island]") as { _vnode?: unknown } | null)?._vnode));

  const share = /<span class="share"[^>]*>Share these reviews<\/span>|<a [^>]*class="share"[^>]*>Share these reviews<\/a>/;

  const parsedAndNow = (): Promise<[string, string]> =>
    page.evaluate(() => [
      (window as { parsed?: string }).parsed ?? "",
      document.body.innerHTML.replace(/<script type="module"[^>]*><\/script>$/, ""),
    ]);

  it("hydrates the home page's store summary at once and a book's island when it is clicked, changing nothing", async ({ skip }) => {
    if (!browser) skip();
    await open("/");
    await page.waitForLoadState("networkidle");
    expect(await Promise.all(messages)).toEqual([]);
    expect(await page.locator('[data-island][data-hydrate="interaction"]').count()).toBe(4);
    expect(scripts.filter((s) => /\/(AddToBasket|Reviews)-/.test(s))).toEqual([]);
    const [parsed, now] = await parsedAndNow();
    expect(now).toBe(parsed);

    const add = page.locator('button.add[aria-label="Add Dune to the basket"]');
    expect(await hydrated('button.add[aria-label="Add Dune to the basket"]')).toBe(false);
    await add.click();
    await page.waitForFunction(() => document.querySelector("#basket .basket")?.textContent === "Basket of guest: 2 books");
    expect(await add.textContent()).toBe("In the basket");
    expect(await hydrated('button.add[aria-label="Add Dune to the basket"]')).toBe(true);
    expect(await hydrated('button.add[aria-label="Add Ficciones to the basket"]')).toBe(false);
    expect(scripts.filter((s) => /\/(AddToBasket|Reviews)-/.test(s))).toEqual([expect.stringMatching(/^\/assets\/AddToBasket-/)]);
    expect(await Promise.all(messages)).toEqual([]);
  });

  it("fetches the code of reviews below the fold only once they are scrolled into view", async ({ skip }) => {
    if (!browser) skip();
    await page.setViewportSize({ width: 800, height: 200 });
    try {
      await open("/books/dune");
      await page.waitForLoadState("networkidle");
      expect(await page.locator(".review-list").evaluate((el) => el.getBoundingClientRect().top > innerHeight)).toBe(true);
      expect(await hydrated(".review-list")).toBe(false);
      expect(scripts.filter((s) => /\/Reviews-/.test(s))).toEqual([]);
      const [parsed, now] = await parsedAndNow();
      expect(now).toBe(parsed);

      await page.locator(".review-list").scrollIntoViewIfNeeded();
      await page.locator(".review-list a.share").waitFor();
      expect(scripts.filter((s) => /\/Reviews-/.test(s))).toEqual([expect.stringMatching(/^\/assets\/Reviews-/)]);
      expect(await Promise.all(messages)).toEqual([]);
      const [, later] = await parsedAndNow();
      expect(later.replace(share, "")).toBe(parsed.replace(share, ""));

      const reviews = page.locator(".review-list li");
      await page.locator("button.more").click();
      await page.locator("button.more").waitFor({ state: "detached" });
      expect(await reviews.evaluateAll((items) => items.map((li) => (li as HTMLElement).style.display))).toEqual(["", "", ""]);
      expect(await Promise.all(messages)).toEqual([]);
    } finally {
      await page.setViewportSize({ width: 1280, height: 720 });
    }
  });

  it("hydrates a streamed book page, whose islands then share the store", async ({ skip }) => {
    if (!browser) skip();
    await open("/books/dune");
    await page.locator(".review-list a.share").waitFor();
    expect(await Promise.all(messages)).toEqual([]);
    expect(await page.title()).toBe("Dune · Ferrovue Books");
    const [parsed, now] = await parsedAndNow();
    expect(parsed).toMatch(/<span class="share"/);
    expect(now).toMatch(/<a [^>]*class="share" href="mailto:\?body=http[^"]*%2Fbooks%2Fdune"/);
    expect(now.replace(share, "")).toBe(parsed.replace(share, ""));

    const summary = page.locator("#basket .basket");
    expect(await summary.textContent()).toBe("Basket of guest: 1 book");
    const add = page.locator("button.add");
    await add.click();
    await page.waitForFunction(() => document.querySelector("#basket .basket")?.textContent === "Basket of guest: 2 books");
    expect(await add.textContent()).toBe("In the basket");
    expect(await add.isDisabled()).toBe(true);

    const reviews = page.locator(".review-list li");
    expect(await reviews.evaluateAll((items) => items.map((li) => (li as HTMLElement).style.display))).toEqual(["", "", "none"]);
    await page.locator("button.more").click();
    await page.locator("button.more").waitFor({ state: "detached" });
    expect(await reviews.evaluateAll((items) => items.map((li) => (li as HTMLElement).style.display))).toEqual(["", "", ""]);
    expect(await Promise.all(messages)).toEqual([]);
  });

  it("hydrates the staff picks as one app, loading only the components its record names", async ({ skip }) => {
    if (!browser) skip();
    await open("/picks");
    await page.locator(".review-list a.share").waitFor();
    expect(await Promise.all(messages)).toEqual([]);
    const [parsedHead, head, title] = await page.evaluate(() => [(window as { parsedHead?: string }).parsedHead ?? "", document.head.innerHTML, document.title]);
    expect(title).toBe("Staff picks · Ferrovue Books");
    expect(head.replace(/<link rel="modulepreload"[^>]*>/g, ""), "unhead's client took over the head the server wrote").toBe(parsedHead);
    const [parsed, now] = await parsedAndNow();
    expect(parsed).toMatch(/<span class="share"/);
    expect(now).toMatch(/<a [^>]*class="share" href="mailto:\?body=http[^"]*%2Fpicks"/);
    expect(now.replace(share, "")).toBe(parsed.replace(share, ""));
    const chunks = scripts.map((s) => /^\/assets\/(\w+)-/.exec(s)?.[1]).filter((c) => c && c !== "main");
    expect(chunks).toEqual(expect.arrayContaining(["picks", "Pick", "Reviews"]));

    const add = page.locator('.pick[data-id="dune"] button.add');
    await add.click();
    await page.waitForFunction(() => document.querySelector('.pick[data-id="dune"] button.add')?.textContent === "In the basket");
    const reviews = page.locator(".review-list li");
    expect(await reviews.evaluateAll((items) => items.map((li) => (li as HTMLElement).style.display))).toEqual(["", "", "none"]);
    await page.locator("button.more").click();
    await page.locator("button.more").waitFor({ state: "detached" });
    expect(await reviews.evaluateAll((items) => items.map((li) => (li as HTMLElement).style.display))).toEqual(["", "", ""]);
    expect(await Promise.all(messages)).toEqual([]);
  });

  it("goes from one staff pick to another without a reload, rendering the page it fetches from its record", async ({ skip }) => {
    if (!browser) skip();
    await open("/picks");
    await page.locator(".review-list a.share").waitFor();
    await page.evaluate(() => void ((window as { stayed?: boolean }).stayed = true));
    const add = page.locator('.pick[data-id="dune"] button.add');
    await add.click();
    await page.waitForFunction(() => document.querySelector('.pick[data-id="dune"] button.add')?.textContent === "In the basket");
    const documents: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "document") documents.push(new URL(r.url()).pathname);
    });

    await page.locator("nav.featured a", { hasText: "The Left Hand of Darkness" }).click();
    await page.waitForFunction(() => document.querySelector(".reviews h2")?.textContent === "Readers on The Left Hand of Darkness");
    expect(page.url()).toBe(`${origin}/picks?featured=left-hand`);
    expect(await page.evaluate(() => (window as { stayed?: boolean }).stayed), "the page did not reload").toBe(true);
    expect(documents).toEqual([]);
    expect(await page.locator(".review-list q").allTextContents()).toEqual(["Winter, and what it does to people."]);
    expect(await page.locator(".review-list a.share").getAttribute("href")).toMatch(/featured%3Dleft-hand$/);
    expect(await page.title()).toBe("Staff picks · Ferrovue Books");
    expect(await add.textContent(), "the next page starts from the state its document carries").toBe("Add to basket");
    await add.click();
    await page.waitForFunction(() => document.querySelector('.pick[data-id="dune"] button.add')?.textContent === "In the basket");

    await page.locator("nav.featured a", { hasText: "Dune" }).click();
    await page.waitForFunction(() => document.querySelector(".reviews h2")?.textContent === "Readers on Dune");
    expect(page.url()).toBe(`${origin}/picks?featured=dune`);
    await page.locator("button.more").click();
    await page.locator("button.more").waitFor({ state: "detached" });
    expect(await page.locator(".review-list li").evaluateAll((items) => items.map((li) => (li as HTMLElement).style.display))).toEqual(["", "", ""]);

    await page.goBack();
    await page.waitForFunction(() => document.querySelector(".reviews h2")?.textContent === "Readers on The Left Hand of Darkness");
    expect(page.url()).toBe(`${origin}/picks?featured=left-hand`);
    expect(await page.evaluate(() => (window as { stayed?: boolean }).stayed)).toBe(true);
    expect(await page.locator("#app").count()).toBe(1);
    expect(await Promise.all(messages)).toEqual([]);
  });
});
