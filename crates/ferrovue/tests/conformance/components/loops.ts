export function thousands(n: number): string {
  const digits = String(Math.abs(n));
  let out = n < 0 ? "-" : "";
  for (const [i, ch] of digits.split("").entries()) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
    out += ch;
  }
  return out;
}

export function stars(n: number, max = 5): string {
  let out = "";
  for (let i = 0; i < Math.min(n, max); i++) out += "★";
  for (let i = Math.max(n, 0); i < max; i++) out += "☆";
  return out;
}

export function reversed(s: string): string {
  let out = "";
  for (const ch of s) out = ch + out;
  return out;
}
