import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Extractor, ExtractorConfig, ExtractorLogLevel } from "@microsoft/api-extractor";

const ROOT = join(import.meta.dirname, "..");
const PACKAGE = join(ROOT, "packages/ferrovue");
const REPORTS = join(PACKAGE, "api");
const CLI_REPORT = "cli.txt";
const check = process.argv.includes("--check");

const pkg = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as { exports: Record<string, string | { types?: string }> };
const entries = Object.entries(pkg.exports).flatMap(([path, target]) =>
  typeof target === "object" && target.types ? [{ name: path === "." ? "ferrovue" : path.slice(2), types: join(PACKAGE, target.types) }] : [],
);

execFileSync("pnpm", ["--filter", "ferrovue", "run", "build"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
mkdirSync(REPORTS, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), "ferrovue-api-"));
const problems: string[] = [];

for (const { name, types } of entries) {
  const config = ExtractorConfig.prepare({
    configObject: {
      projectFolder: PACKAGE,
      mainEntryPointFilePath: types,
      compiler: {
        overrideTsconfig: {
          compilerOptions: { target: "ES2024", lib: ["ES2024", "DOM", "DOM.Iterable"], module: "NodeNext", moduleResolution: "NodeNext", types: ["node"], strict: true, skipLibCheck: true },
          include: ["dist/**/*.d.ts"],
        },
      },
      apiReport: { enabled: true, reportFolder: REPORTS, reportTempFolder: temp, reportFileName: name },
      docModel: { enabled: false },
      dtsRollup: { enabled: false },
      tsdocMetadata: { enabled: false },
      newlineKind: "lf",
      messages: {
        compilerMessageReporting: { default: { logLevel: ExtractorLogLevel.Error } },
        extractorMessageReporting: {
          default: { logLevel: ExtractorLogLevel.None, addToApiReportFile: true },
          "ae-missing-release-tag": { logLevel: ExtractorLogLevel.None, addToApiReportFile: false },
          "ae-undocumented": { logLevel: ExtractorLogLevel.None, addToApiReportFile: false },
        },
        tsdocMessageReporting: { default: { logLevel: ExtractorLogLevel.None, addToApiReportFile: false } },
      },
    },
    configObjectFullPath: undefined,
    packageJsonFullPath: join(PACKAGE, "package.json"),
  });
  const result = Extractor.invoke(config, {
    localBuild: !check,
    messageCallback: (message) => {
      if (message.logLevel !== ExtractorLogLevel.Error && message.logLevel !== ExtractorLogLevel.Warning) message.handled = true;
    },
  });
  if (result.errorCount > 0) problems.push(`${name}: API Extractor reported ${result.errorCount} errors`);
  if (check && result.apiReportChanged) problems.push(`${name}: the public API differs from api/${name}.api.md`);
}

const help = execFileSync(process.execPath, [join(PACKAGE, "dist/cli.js"), "--help"], { encoding: "utf8" });
const reported = new Set([...entries.map((e) => `${e.name}.api.md`), CLI_REPORT]);
if (check) {
  let committed = "";
  try {
    committed = readFileSync(join(REPORTS, CLI_REPORT), "utf8");
  } catch {}
  if (committed !== help) problems.push(`cli: \`ferrovue --help\` differs from api/${CLI_REPORT}`);
  for (const file of readdirSync(REPORTS)) if (!reported.has(file)) problems.push(`${file}: no export of the package has this report`);
} else {
  writeFileSync(join(REPORTS, CLI_REPORT), help);
  for (const file of readdirSync(REPORTS)) if (!reported.has(file)) rmSync(join(REPORTS, file));
}
rmSync(temp, { recursive: true, force: true });

if (problems.length) {
  console.error(`${problems.join("\n")}\n\nThe npm package's public API changed. If that is intended, run \`pnpm api:report\` and commit packages/ferrovue/api.`);
  process.exit(1);
}
console.log(check ? "packages/ferrovue/api is up to date" : `wrote ${reported.size} reports to packages/ferrovue/api`);
