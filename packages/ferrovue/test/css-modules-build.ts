import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import vue from "@vitejs/plugin-vue";
import { build, type Rolldown } from "vite";

const [dir, files, config] = process.argv.slice(2).map((a) => JSON.parse(a) as unknown) as [string, string[], { generateScopedName: string; hashPrefix?: string; scopeId?: string }];
const entry = "virtual:css-modules";
process.env.NODE_ENV = "production";
const result = (await build({
  configFile: false,
  root: dir,
  logLevel: "warn",
  plugins: [
    vue(config.scopeId === "filepath" ? { features: { componentIdGenerator: "filepath" } } : {}),
    {
      name: "entry",
      resolveId: (id) => (id.endsWith(entry) ? `\0${entry}` : null),
      load: (id) => (id === `\0${entry}` ? files.map((f, i) => `export { default as c${i} } from ${JSON.stringify(join(dir, f))};`).join("\n") : null),
    },
  ],
  css: { modules: { generateScopedName: config.generateScopedName, ...(config.hashPrefix !== undefined ? { hashPrefix: config.hashPrefix } : {}) } },
  build: { write: false, minify: false, ssr: entry },
})) as Rolldown.RolldownOutput;
const code = result.output.find((o): o is Rolldown.OutputChunk => o.type === "chunk" && o.isEntry)!.code;
const built = join(import.meta.dirname, `.css-modules-${process.pid}.mjs`);
try {
  writeFileSync(built, code);
  const loaded = (await import(built)) as Record<string, { __cssModules?: Record<string, Record<string, string>> }>;
  process.stdout.write(JSON.stringify(Object.fromEntries(files.map((f, i) => [f, { ...loaded[`c${i}`]!.__cssModules }]))));
} finally {
  rmSync(built, { force: true });
}
