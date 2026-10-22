const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const THIRD = 1 / 3;
const LIMIT = 2 ** 40 - 1;
const ODD = -(7 % 4) + +2.5;
const BASE = "/feed";
const NEWEST = `${BASE}/new?days=${DAY / HOUR}`;
const MARK = "#" + 1.5 + "/" + THIRD;

export function grouped(n: number): string {
  const d = String(n);
  return d.split("").reduce((acc, ch, i) => (i > 0 && ch !== "-" && d[i - 1] !== "-" && (d.length - i) % 3 === 0 ? `${acc},${ch}` : `${acc}${ch}`), "");
}

export function sliced(n: number): string {
  const d = Math.abs(n).toFixed(0);
  const sign = n < 0 ? "-" : "";
  if (d.length <= 3) return `${sign}${d}`;
  if (d.length <= 6) return `${sign}${d.slice(0, d.length - 3)},${d.slice(-3)}`;
  return `${sign}${d.slice(0, d.length - 6)},${d.slice(d.length - 6, d.length - 3)},${d.slice(-3)}`;
}

export function duration(seconds: number): string {
  const pad = (k: number) => String(k).padStart(2, "0");
  const days = Math.floor(seconds / DAY);
  const rest = seconds - days * DAY;
  return `${days}d ${pad(Math.floor(rest / HOUR))}:${pad(Math.floor((rest % HOUR) / MINUTE))}`;
}

export function tagged(words: string[]): string {
  const sep = words.length > 2 ? "; " : ", ";
  const tag = (w: string) => `${MARK}${sep}${w.toUpperCase()}`;
  const first = (w: string) => w[0] ?? "?";
  return words.map((w) => `${tag(w)}${first(w)}`).join(" ") + `|${NEWEST}|${LIMIT}|${ODD}`;
}
