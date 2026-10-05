/* The server's pages, hydrated by the client in real browsers.
 *
 * `test/hydration.test.ts` hydrates the same pages in happy-dom; this runs the whole thing as a
 * reader gets it. The client is built once (`vite build`, with Vue's mismatch details kept, which
 * production builds leave out), the server is started on a free port to serve it, and each page
 * is opened in each browser. The test fails on any warning or error the page logs, checks that
 * hydrating left the document as the browser parsed it, that a page fetches the code of its own
 * islands alone, and clicks through the islands. */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox, webkit, type Browser, type ConsoleMessage, type Page } from "playwright";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = join(import.meta.dirname, "..");
const LAUNCHERS = { chromium, firefox, webkit };
/** The browsers to run in. One that will not launch fails the run in CI, and elsewhere is skipped
 * with a warning: WebKit, for one, needs system libraries only some Linux systems have. */
const BROWSERS = (process.env.FERROVUE_BROWSERS ?? "chromium,firefox,webkit").split(",") as (keyof typeof LAUNCHERS)[];

let dist = "";
let server: ChildProcess | undefined;
let origin = "";

/** The server binary, built if it is not current. */
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

/** Start the server on a free port, serving the client in `dist`; resolves with its origin. */
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
  // Vitest runs with `NODE_ENV=test`, which Vite would build Vue's development branches for.
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  await build({
    configFile: join(HERE, "vite.config.ts"),
    root: HERE,
    logLevel: "warn",
    // Production Vue, as a reader gets it, but reporting what mismatched: without this it checks no
    // attribute at all.
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

/** A console message as Vue wrote it, with the elements it names as markup, not `JSHandle@node`. */
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
  /** The scripts the page fetched: each island's code only where the page holds one. */
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
      // The page's own, not the browser's (Firefox's password manager warns on some pages).
      if ((m.type() === "warning" || m.type() === "error") && m.location().url.startsWith(origin)) messages.push(describeMessage(m));
    });
    page.on("pageerror", (e) => void messages.push(Promise.resolve(`uncaught: ${e.message}`)));
    page.on("request", (r) => {
      if (r.resourceType() === "script") scripts.push(new URL(r.url()).pathname);
    });
    // The document as the browser parsed it, kept by a script the page runs just before the
    // client's: what hydrating must leave as it is.
    await page.route(`${origin}/**`, async (route) => {
      if (route.request().resourceType() !== "document") return route.continue();
      const response = await route.fetch();
      const snapshot = "<script>document.currentScript.remove(); window.parsed = document.body.innerHTML;</script>";
      return route.fulfill({ response, body: (await response.text()).replace('<script type="module"', `${snapshot}$&`) });
    });
  });
  afterAll(async () => {
    await browser?.close();
  });

  /** Open the page at `path`, and wait until every island and the basket summary are hydrated. */
  async function open(path: string): Promise<void> {
    messages = [];
    scripts = [];
    await page.goto(`${origin}${path}`);
    // An app's container holds its root vnode once it has mounted.
    await page.waitForFunction(() =>
      [...document.querySelectorAll("[data-island], #basket")].every((el) => (el as { _vnode?: unknown })._vnode),
    );
  }

  /** The document now, without the client's `<script>`, which came after the snapshot. */
  const parsedAndNow = (): Promise<[string, string]> =>
    page.evaluate(() => [
      (window as { parsed?: string }).parsed ?? "",
      document.body.innerHTML.replace(/<script type="module"[^>]*><\/script>$/, ""),
    ]);

  it("hydrates the home page, an island per book and the store's summary, changing nothing", async ({ skip }) => {
    if (!browser) skip();
    await open("/");
    expect(await Promise.all(messages)).toEqual([]);
    expect(await page.locator("[data-island]").count()).toBe(4);
    // Four AddToBasket islands, and no Reviews to load.
    expect(scripts.filter((s) => /\/(AddToBasket|Reviews)-/.test(s))).toEqual([expect.stringMatching(/^\/assets\/AddToBasket-/)]);
    const [parsed, now] = await parsedAndNow();
    expect(now).toBe(parsed);
  });

  it("hydrates a streamed book page, whose islands then share the store", async ({ skip }) => {
    if (!browser) skip();
    await open("/books/dune");
    expect(await Promise.all(messages)).toEqual([]);
    const [parsed, now] = await parsedAndNow();
    expect(now).toBe(parsed);

    // The island's click reaches the shared store, and the separately hydrated summary shows it.
    const summary = page.locator("#basket .basket");
    expect(await summary.textContent()).toBe("Basket of guest: 1 book");
    const add = page.locator("button.add");
    await add.click();
    await page.waitForFunction(() => document.querySelector("#basket .basket")?.textContent === "Basket of guest: 2 books");
    expect(await add.textContent()).toBe("In the basket");
    expect(await add.isDisabled()).toBe(true);

    // The streamed reviews island: two of three shown, until the button shows the rest.
    const reviews = page.locator(".review-list li");
    expect(await reviews.evaluateAll((items) => items.map((li) => (li as HTMLElement).style.display))).toEqual(["", "", "none"]);
    await page.locator("button.more").click();
    await page.locator("button.more").waitFor({ state: "detached" });
    expect(await reviews.evaluateAll((items) => items.map((li) => (li as HTMLElement).style.display))).toEqual(["", "", ""]);
    expect(await Promise.all(messages)).toEqual([]);
  });
});
