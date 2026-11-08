import { type Field } from "./model.ts";

export const RUST_KEYWORDS = new Set(
  "as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while async await dyn abstract become box do final macro override priv typeof unsized virtual yield try".split(
    " ",
  ),
);

const NOT_RAW = new Set(["self", "Self", "super", "crate"]);

export const RUST_PRELUDE = new Set(["Option", "Some", "None", "Vec", "String", "Box", "Result", "Ok", "Err", "Cow", "Slots", "Default"]);

/** `hint` in snake case, letters and digits joined by `_`, or `value` when it has none. */
export function snakeWords(hint: string): string {
  const words = hint
    .replace(/^r#/, "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return words || "value";
}

export function snake(js: string): string {
  const s = js.includes("$") ? snakeWords(js) : js.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()).replace(/^_/, "");
  if (NOT_RAW.has(s)) return `${s}_`;
  return RUST_KEYWORDS.has(s) ? `r#${s}` : s;
}

/** The Rust name of each of `names`, JavaScript names that share a namespace, by `rustOf`: a name
 * holding `$` takes `_2`, `_3`, … after a Rust name another of them holds. */
export function dollarNames(names: Iterable<string>, rustOf: (js: string) => string = snake): Map<string, string> {
  const all = [...new Set(names)];
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const js of all.filter((n) => !n.includes("$"))) {
    out.set(js, rustOf(js));
    taken.add(rustOf(js).replace(/^r#/, ""));
  }
  for (const js of all.filter((n) => n.includes("$"))) {
    const first = rustOf(js);
    const bare = first.replace(/^r#/, "");
    let name = first;
    for (let i = 2; taken.has(name.replace(/^r#/, "")); i++) name = `${bare}_${i}`;
    taken.add(name.replace(/^r#/, ""));
    out.set(js, name);
  }
  return out;
}

/** `fields`, with each field whose JavaScript name holds `$` given a Rust name no other field holds. */
export function distinctFields<F extends Field>(fields: F[]): F[] {
  if (!fields.some((f) => f.js.includes("$"))) return fields;
  const held = new Map(fields.map((f) => [f.js, f.rust]));
  const names = dollarNames(held.keys(), (js) => (js.includes("$") ? snake(js) : held.get(js)!));
  return fields.map((f) => (f.js.includes("$") ? { ...f, rust: names.get(f.js)! } : f));
}

export function rustStr(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20 || c === 0x7f || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) out += `\\u{${c.toString(16)}}`;
    else out += ch;
  }
  return out + '"';
}

export function rustChar(ch: string): string {
  if (ch === "'") return "'\\''";
  if (ch === '"') return `'"'`;
  return `'${rustStr(ch).slice(1, -1)}'`;
}
