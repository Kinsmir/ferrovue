import { ctx } from "./context.ts";

const TOKEN = /(?<![\w$])(?<![^.]\.)(_?)(fv_[a-z]+\d+)(?![\w$])/g;

const IDENT = /(?<![\w$])[A-Za-z_]\w*/g;

const CHAR = /'(?:[^'\\]|\\u\{[0-9a-f]+\}|\\.)'/y;

/** A Rust local the compiler declares: a name unique in the compile, which `readable` gives its
 * final name, `fv_` and `hint` in snake case, when the function holding it is written. `role`
 * keeps apart the kinds of locals the compiler tells by name. */
export function fresh(role: string, hint: string): string {
  const name = `fv_${role}${++ctx.narrowCount}`;
  ctx.hints.set(name, hint);
  return name;
}

/** The word a JavaScript name, or a path such as `user.name`, gives the local that holds it. */
export function jsHint(name: string): string {
  if (/^fv#\d+$/.test(name)) return "destructured";
  if (/^switch#\d+$/.test(name)) return "subject";
  if (name.startsWith("fv$")) return name.slice(3).replace(/\d+$/, "");
  let path = name;
  while (/\[[^[\]]*\]/.test(path)) path = path.replace(/\[[^[\]]*\]/g, "");
  return (path.split(".").at(-1) ?? "").replace(/#\d+$/, "");
}

function snakeWords(hint: string): string {
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

function segments(code: string): { text: string; code: boolean }[] {
  const out: { text: string; code: boolean }[] = [];
  let from = 0;
  const push = (to: number, isCode: boolean, end: number): void => {
    if (to > from) out.push({ text: code.slice(from, to), code: true });
    if (end > to) out.push({ text: code.slice(to, end), code: isCode });
    from = end;
  };
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < code.length && code[j] !== '"') j += code[j] === "\\" ? 2 : 1;
      push(i, false, j + 1);
      i = j;
    } else if (ch === "'") {
      CHAR.lastIndex = i;
      const m = CHAR.exec(code);
      if (m) {
        push(i, false, i + m[0].length);
        i += m[0].length - 1;
      }
    } else if (ch === "/" && code[i + 1] === "/") {
      const j = code.indexOf("\n", i);
      const end = j < 0 ? code.length : j;
      push(i, false, end);
      i = end - 1;
    }
  }
  push(code.length, true, code.length);
  return out;
}

/** `code`, one Rust function, with the locals `fresh` named given their final names: `fv_` and
 * the hint, with `_2`, `_3`, … after a name the function already holds, counted in the order the
 * locals first appear. */
export function readable(code: string): string {
  const parts = segments(code);
  const taken = new Set<string>();
  const order: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (!part.code) continue;
    for (const m of part.text.matchAll(IDENT)) {
      const token = /^_?(fv_[a-z]+\d+)$/.exec(m[0])?.[1];
      if (token !== undefined && ctx.hints.has(token)) {
        if (!seen.has(token)) order.push(token);
        seen.add(token);
      } else taken.add(m[0]);
    }
  }
  if (order.length === 0) return code;
  const names = new Map<string, string>();
  for (const token of order) {
    const base = `fv_${snakeWords(ctx.hints.get(token)!)}`;
    let name = base;
    for (let n = 2; taken.has(name) || taken.has(`_${name}`); n++) name = `${base}_${n}`;
    taken.add(name);
    names.set(token, name);
  }
  return parts.map((part) => (part.code ? part.text.replace(TOKEN, (whole, under: string, token: string) => (names.has(token) ? `${under}${names.get(token)!}` : whole)) : part.text)).join("");
}
