export function unifiedDiff(path: string, before: string, after: string): string {
  const lines = (text: string): string[] => (text === "" ? [] : text.replace(/\n$/, "").split("\n"));
  const a = lines(before);
  const b = lines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  if (!midA.length && !midB.length) return "";
  const lcs = Array.from({ length: midA.length + 1 }, () => new Uint32Array(midB.length + 1));
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      lcs[i]![j] = midA[i] === midB[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const edits: { op: " " | "-" | "+"; text: string }[] = a.slice(0, head).map((text) => ({ op: " ", text }));
  let i = 0;
  let j = 0;
  while (i < midA.length || j < midB.length) {
    if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
      edits.push({ op: " ", text: midA[i++]! });
      j++;
    } else if (j < midB.length && (i === midA.length || lcs[i]![j + 1]! > lcs[i + 1]![j]!)) edits.push({ op: "+", text: midB[j++]! });
    else edits.push({ op: "-", text: midA[i++]! });
  }
  edits.push(...a.slice(a.length - tail).map((text) => ({ op: " " as const, text })));
  const CONTEXT = 3;
  const hunks: [number, number][] = [];
  edits.forEach((e, k) => {
    if (e.op === " ") return;
    const from = Math.max(0, k - CONTEXT);
    const to = Math.min(edits.length - 1, k + CONTEXT);
    const last = hunks.at(-1);
    if (last && from <= last[1] + 1) last[1] = to;
    else hunks.push([from, to]);
  });
  const out = [`--- ${a.length ? `a/${path}` : "/dev/null"}`, `+++ ${b.length ? `b/${path}` : "/dev/null"}`];
  let lineA = 1;
  let lineB = 1;
  const at = edits.map((e) => {
    const here = [lineA, lineB] as const;
    if (e.op !== "+") lineA++;
    if (e.op !== "-") lineB++;
    return here;
  });
  for (const [from, to] of hunks) {
    const span = edits.slice(from, to + 1);
    const countA = span.filter((e) => e.op !== "+").length;
    const countB = span.filter((e) => e.op !== "-").length;
    const startA = countA ? at[from]![0] : at[from]![0] - 1;
    const startB = countB ? at[from]![1] : at[from]![1] - 1;
    out.push(`@@ -${startA},${countA} +${startB},${countB} @@`, ...span.map((e) => `${e.op}${e.text}`));
  }
  return out.join("\n");
}
