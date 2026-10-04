/* The functions a conformance component may call, each with a Rust twin in `../helpers.rs` that must
 * agree with it byte for byte. */

/** `"s"` unless there is exactly one. */
export function plural(n: number): string {
  return n === 1 ? "" : "s";
}

/** A class for a score: its sign, or `unknown` when there is none. */
export function tone(score: number | undefined): string {
  if (score === undefined) return "unknown";
  return score > 0 ? "positive" : score < 0 ? "negative" : "zero";
}

export function isEven(n: number): boolean {
  return n % 2 === 0;
}

/** The value, or an em dash standing in for nothing. */
export function orDash(s: string | undefined): string {
  return s ? s : "—";
}
