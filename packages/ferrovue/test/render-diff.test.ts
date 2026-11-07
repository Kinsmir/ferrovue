import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { compareRendered, conformanceTests, testRoot } from "../src/render-diff.ts";
import { visibleText } from "../src/visible.ts";

const REPO = join(import.meta.dirname, "../../..");
const CLI = join(import.meta.dirname, "../src/cli.ts");

describe("visibleText", () => {
  it("starts a line at each block element and `<br>`, and shows a run of whitespace as one space", () => {
    expect(visibleText("<div><p> Hello,\n  <b>Ada</b> </p><ul><li>one</li><li>two</li></ul>a<br>b</div>")).toBe("Hello, Ada\none\ntwo\na\nb");
    expect(visibleText("<p><span>by</span><a>Ada</a></p>")).toBe("byAda");
    expect(visibleText("<p><span>by</span> <a>Ada</a></p>")).toBe("by Ada");
  });

  it("keeps the whitespace of `<pre>` and `<textarea>`, and shows nothing of comments, scripts, styles and templates", () => {
    expect(visibleText("<pre>  a\n    b</pre><textarea> c </textarea>")).toBe("  a\n    b\n c ");
    expect(visibleText('<p>a<!-- x --><script>let s = "<p>"</script><style>p{}</style><template><b>t</b></template>b</p>')).toBe("ab");
  });

  it("decodes character references", () => {
    expect(visibleText("<p>&lt;a&gt; &amp; &quot;b&#39; &#x41;&#66;&nbsp;c &unknown;</p>")).toBe("<a> & \"b' AB c &unknown;");
  });
});

describe("compareRendered", () => {
  it("tells a change of text from one of markup alone, and lists added and removed fixtures", () => {
    const before = new Map([
      ["c/A/typical", "<p><span>by</span><a>Ada</a></p>"],
      ["c/B/typical", "<p>\n  same\n</p>"],
      ["c/C/typical", "<p>x</p>"],
      ["c/D/typical", "<p>gone</p>"],
    ]);
    const after = new Map([
      ["c/A/typical", "<p><span>by</span> <a>Ada</a></p>"],
      ["c/B/typical", "<p>same</p>"],
      ["c/C/typical", "<p>x</p>"],
      ["c/E/typical", "<p>new</p>"],
    ]);
    const { changes, same } = compareRendered(before, after);
    expect(same).toBe(1);
    expect(changes.map((c) => `${c.fixture} ${c.change}`)).toEqual(["c/A/typical text", "c/B/typical markup", "c/D/typical removed", "c/E/typical added"]);
    expect(changes[0]!.diff).toContain("-byAda\n+by Ada");
  });
});

describe("ferrovue diff", () => {
  const project = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "ferrovue-diff-test-"));
    symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"), "junction");
    mkdirSync(join(dir, "components"));
    mkdirSync(join(dir, "fixtures/Byline"), { recursive: true });
    writeFileSync(join(dir, ".gitignore"), "node_modules\n");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "diff-test", private: true, type: "module" }));
    writeFileSync(join(dir, "vitest.config.ts"), `import vue from "@vitejs/plugin-vue";\nexport default { plugins: [vue()], test: { environment: "happy-dom" } };\n`);
    writeFileSync(
      join(dir, "conformance.test.ts"),
      `import { describe, it } from "vitest";\nimport { registerConformance } from ${JSON.stringify(pathToFileURL(join(REPO, "packages/ferrovue/src/conformance.ts")).href)};\nconst components = import.meta.glob("./components/*.vue", { eager: true });\nregisterConformance({ describe, it }, { config: "ferrovue.config.json", components });\n`,
    );
    writeFileSync(join(dir, "components/Byline.vue"), `<script setup lang="ts">\ndefineProps<{ name: string }>();\n</script>\n\n<template>\n  <p>\n    <span>by</span>\n    <a>{{ name }}</a>\n  </p>\n</template>\n`);
    writeFileSync(join(dir, "fixtures/Byline/typical.json"), JSON.stringify({ name: "Ada" }));
    writeFileSync(join(dir, "ferrovue.config.json"), JSON.stringify({ components: "components", out: "generated" }));
    const git = (...args: string[]): void => void execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { stdio: "ignore" });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "condense");
    return dir;
  };

  it("finds the test files that register the suite, from the directory of the Vitest configuration", () => {
    const dir = project();
    try {
      mkdirSync(join(dir, "sub"));
      expect(testRoot(join(dir, "sub"), dir)).toBe(dir);
      expect(conformanceTests(dir)).toEqual(["conformance.test.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports the fixture whose text a change of configuration changes, and exits 1", () => {
    const dir = project();
    try {
      const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: "utf8" });
      const unchanged = run("diff", "--against", "HEAD");
      expect(unchanged.stderr).toBe("");
      expect(unchanged.stdout).toContain("against HEAD: 0 with other text, 0 with other markup and the same text, 1 the same");
      expect(unchanged.status).toBe(0);
      writeFileSync(join(dir, "ferrovue.config.json"), JSON.stringify({ components: "components", out: "generated", whitespace: "trim-edges" }));
      const changed = run("diff", "--against", "HEAD", "--format", "json");
      expect(changed.status).toBe(1);
      const result = JSON.parse(changed.stdout) as { changes: { fixture: string; change: string; diff: string }[]; same: number };
      expect(result.changes.map((c) => `${c.fixture} ${c.change}`)).toEqual(["ferrovue.config.json/Byline/typical text"]);
      expect(result.changes[0]!.diff).toContain("-byAda\n+by Ada");
      const missing = run("diff", "--against", "no-such-ref");
      expect(missing.status).toBe(2);
      expect(missing.stderr).toMatch(/'no-such-ref' names no commit/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
