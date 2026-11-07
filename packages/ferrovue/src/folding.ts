const PUSH = /^( *)out\.push(?:_str\("((?:[^"\\]|\\.)*)"\)|\('((?:[^'\\]|\\u\{[0-9a-f]+\}|\\.))'\));$/;

const MOVED = 48;

const SEPARATOR = /^\} else(?: if .*)? \{$/;

interface Push {
  indent: string;
  text: string;
}

interface Chain {
  opener: number;
  separators: number[];
  close: number;
}

function indentOf(line: string): string {
  return /^ */.exec(line)![0];
}

function push(line: string | undefined): Push | undefined {
  const m = line === undefined ? null : PUSH.exec(line);
  if (!m) return undefined;
  const ch = m[3];
  if (ch === undefined) return { indent: m[1]!, text: m[2]! };
  return { indent: m[1]!, text: ch === "\\'" ? "'" : ch === '"' ? '\\"' : ch };
}

function pushed(indent: string, text: string): string {
  return `${indent}out.push_str("${text}");`;
}

function chainAt(lines: string[], opener: number): Chain | undefined {
  const indent = indentOf(lines[opener]!);
  const head = lines[opener]!.slice(indent.length);
  if (!head.startsWith("if ") || !head.endsWith(" {")) return undefined;
  const separators: number[] = [];
  for (let i = opener + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const own = indentOf(line).length;
    if (own > indent.length) continue;
    if (own < indent.length) return undefined;
    const rest = line.slice(own);
    if (SEPARATOR.test(rest)) {
      separators.push(i);
      continue;
    }
    if (rest !== "}" || separators.length === 0 || lines[separators.at(-1)!]!.slice(own) !== "} else {") return undefined;
    return { opener, separators, close: i };
  }
  return undefined;
}

function chainEndingAt(lines: string[], close: number): Chain | undefined {
  const indent = indentOf(lines[close]!);
  if (lines[close] !== `${indent}}`) return undefined;
  for (let i = close - 1; i >= 0; i--) {
    const line = lines[i]!;
    const own = indentOf(line).length;
    if (own > indent.length || (own === indent.length && SEPARATOR.test(line.slice(own)))) continue;
    if (own < indent.length) return undefined;
    const chain = chainAt(lines, i);
    return chain?.close === close ? chain : undefined;
  }
  return undefined;
}

function starts(chain: Chain): number[] {
  return [chain.opener, ...chain.separators];
}

function bounds(chain: Chain): number[] {
  return [...chain.separators, chain.close];
}

function ends(chain: Chain): number[] {
  return bounds(chain).map((at) => at - 1);
}

function heads(lines: string[], chain: Chain): string[] {
  return starts(chain).map((at) => lines[at]!.trimStart().replace(/^\} /, "").slice(0, -2));
}

function edges(lines: string[], chain: Chain, at: number[], indent: string): Push[] | undefined {
  const found: Push[] = [];
  for (const [i, line] of at.entries()) {
    const edge = line > starts(chain)[i]! && line < bounds(chain)[i]! ? push(lines[line]) : undefined;
    if (edge === undefined || edge.indent !== `${indent}    `) return undefined;
    found.push(edge);
  }
  return found;
}

function sink(lines: string[]): boolean {
  let changed = false;
  for (let close = lines.length - 2; close >= 0; close--) {
    const after = push(lines[close + 1]);
    const chain = after === undefined ? undefined : chainEndingAt(lines, close);
    if (after === undefined || after.text.length > MOVED || chain === undefined || after.indent !== indentOf(lines[close]!)) continue;
    const tails = edges(lines, chain, ends(chain), after.indent);
    if (tails === undefined) continue;
    ends(chain).forEach((at, i) => (lines[at] = pushed(tails[i]!.indent, tails[i]!.text + after.text)));
    lines.splice(close + 1, 1);
    changed = true;
  }
  return changed;
}

function hoist(lines: string[]): boolean {
  let changed = false;
  for (let at = lines.length - 2; at >= 0; at--) {
    const before = push(lines[at]);
    const chain = before === undefined ? undefined : chainAt(lines, at + 1);
    if (before === undefined || before.text.length > MOVED || chain === undefined || before.indent !== indentOf(lines[at + 1]!)) continue;
    if (heads(lines, chain).some((h) => /\?|\bout\b|\breturn\b|\bbreak\b|\bcontinue\b/.test(h))) continue;
    const firsts = starts(chain).map((s) => s + 1);
    const leads = edges(lines, chain, firsts, before.indent);
    if (leads === undefined) continue;
    firsts.forEach((line, i) => (lines[line] = pushed(leads[i]!.indent, before.text + leads[i]!.text)));
    lines.splice(at, 1);
    changed = true;
  }
  return changed;
}

function collapse(lines: string[]): boolean {
  let changed = false;
  for (let opener = lines.length - 1; opener >= 0; opener--) {
    const chain = chainAt(lines, opener);
    if (chain === undefined || ends(chain).some((at, i) => at !== starts(chain)[i]! + 1)) continue;
    const texts = ends(chain).map((at) => push(lines[at])?.text);
    const tests = heads(lines, chain);
    if (texts.some((t) => t === undefined) || tests.some((h) => /^(?:else )?if let /.test(h))) continue;
    const known = tests[0] === "if true" ? 0 : tests[0] === "if false" && tests.length === 2 ? 1 : undefined;
    const expr = known === undefined ? tests.map((h, i) => `${h} { "${texts[i]!}" }`).join(" ") : `"${texts[known]!}"`;
    lines.splice(opener, chain.close - opener + 1, `${indentOf(lines[opener]!)}out.push_str(${expr});`);
    changed = true;
  }
  return changed;
}

function join(lines: string[]): boolean {
  let changed = false;
  for (let at = lines.length - 2; at >= 0; at--) {
    const [first, second] = [push(lines[at]), push(lines[at + 1])];
    if (first === undefined || second === undefined || first.indent !== second.indent) continue;
    lines.splice(at, 2, pushed(first.indent, first.text + second.text));
    changed = true;
  }
  return changed;
}

/** The statements of a render, with short text written next to an `if` chain whose every branch
 * starts or ends in text moved into each branch, and a chain whose every branch only writes text
 * made one write of the text its test picks, or of the text a test known at compile time picks. */
export function foldBranches(lines: string[]): string[] {
  const folded = lines.join("\n").split("\n");
  for (;;) {
    while (sink(folded) || hoist(folded));
    const collapsed = collapse(folded);
    if (!join(folded) && !collapsed) return folded;
  }
}
