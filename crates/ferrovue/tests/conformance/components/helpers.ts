export function plural(n: number): string {
  return n === 1 ? "" : "s";
}

export function tone(score: number | undefined): string {
  if (score === undefined) return "unknown";
  return score > 0 ? "positive" : score < 0 ? "negative" : "zero";
}

export function isEven(n: number): boolean {
  return n % 2 === 0;
}

export function orDash(s: string | undefined): string {
  return s ? s : "—";
}
