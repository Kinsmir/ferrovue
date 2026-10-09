import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AREAS, type ErrorDoc, ERRORS } from "../src/errors.ts";

const SRC = join(import.meta.dirname, "../src");
const INDEX = join(import.meta.dirname, "../../../crates/ferrovue/docs/guide/error_codes.md");
const REGISTRY = join(SRC, "errors.ts");

const documented = Object.entries(ERRORS as Record<string, ErrorDoc>);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
}

function used(): Set<string> {
  const files = sources(SRC).filter((f) => f !== REGISTRY);
  return new Set(files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/"(FV\d{4})"/g)].map((m) => m[1]!)));
}

function index(): string {
  const sections = Object.entries(AREAS).toSorted(([a], [b]) => a.localeCompare(b)).map(([area, { name, guide }]) => {
    const codes = documented.filter(([code]) => code.slice(2, 4) === area);
    const see = guide ? `\n\nSee [\`${guide}\`](crate::guide::${guide}).` : "";
    const entries = codes.map(([code, doc]) => {
      const retired = doc.retired ? ` Retired in ${doc.retired}: the compiler no longer raises it.` : "";
      return `## ${code}\n\n${doc.title}.${retired}${doc.detail ? `\n\n${doc.detail}` : ""}`;
    });
    return `# ${name}: FV${area}xx${see}\n\n${entries.join("\n\n")}`;
  });
  return `Every error the compiler raises has a stable code, shown as \`error[FV0602]\` and in the \`code\`
field of \`ferrovue --format json\`. A code names one kind of refusal and is never given to another:
one the compiler stops raising stays listed here, marked retired. The first two digits are the
area. [\`errors_and_limits\`](crate::guide::errors_and_limits) explains what the compiler refuses
and why. A warning, such as one for a deprecated configuration key, has a code of its own, shown as
\`warning[FV1117]\` and with the \`severity\` \`"warning"\` in JSON.

This page is generated from the compiler's list in \`packages/ferrovue/src/errors.ts\` by
\`pnpm errors:generate\`; \`pnpm test\` fails when the two differ.

${sections.join("\n\n")}
`;
}

describe("error codes", () => {
  it("are four digits after FV, in a known area, each listed once with its own title", () => {
    const keys = [...readFileSync(REGISTRY, "utf8").matchAll(/^ {2}(FV\d{4}): /gm)].map((m) => m[1]!);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
    expect(keys.toSorted()).toEqual(documented.map(([code]) => code).toSorted());
    for (const [code] of documented) {
      expect(code).toMatch(/^FV\d{4}$/);
      expect(AREAS[code.slice(2, 4)], code).toBeDefined();
    }
    const titles = documented.map(([, doc]) => doc.title);
    expect(titles.filter((t, i) => titles.indexOf(t) !== i)).toEqual([]);
  });

  it("are each raised somewhere, and every one raised is documented", () => {
    const raised = used();
    expect([...raised.keys()].filter((code) => !(code in ERRORS))).toEqual([]);
    expect(documented.filter(([code, doc]) => !doc.retired && !raised.has(code)).map(([code]) => code)).toEqual([]);
    expect(documented.filter(([code, doc]) => doc.retired && raised.has(code)).map(([code]) => code)).toEqual([]);
  });

  it("are written in the guide's index as the list holds them", () => {
    if (process.env.FERROVUE_ERRORS_WRITE) writeFileSync(INDEX, index());
    expect(readFileSync(INDEX, "utf8"), "run `pnpm errors:generate`").toBe(index());
  });
});
