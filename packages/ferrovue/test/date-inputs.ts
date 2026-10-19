export const DATE_METHODS = [
  "toISOString",
  "toUTCString",
  "toJSON",
  "getUTCFullYear",
  "getUTCMonth",
  "getUTCDate",
  "getUTCDay",
  "getUTCHours",
  "getUTCMinutes",
  "getUTCSeconds",
  "getUTCMilliseconds",
] as const;

/** The strings for `Date.parse` written by hand: the edges of the format and of the range of dates. */
export const HAND_STRINGS = [
  "",
  " ",
  "2024",
  "2024-02",
  "2024-02-29",
  "2023-02-29",
  "2024-02-30",
  "2024-02-31",
  "2024-04-30",
  "2024-04-31",
  "1900-02-29",
  "2000-02-29",
  "2024-13",
  "2024-00",
  "2024-01-00",
  "2024-01-32",
  "2024-1-5",
  "2024-01-5",
  "20240115",
  "2024-01-15T10:00Z",
  "2024-01-15T10:00",
  "2024-01-15T10:00:00",
  "2024-01-15T10:00:00.000",
  "2024-01-15T10:00:00Z",
  "2024-01-15T10:00:00.000Z",
  "2024-01-15T10:00:00.123Z",
  "2024-01-15T10:00:00.1Z",
  "2024-01-15T10:00:00.12Z",
  "2024-01-15T10:00:00.1234Z",
  "2024-01-15T10:00:00,123Z",
  "2024-01-15t10:00z",
  "2024-01-15T10:00z",
  "2024-01-15t10:00Z",
  "2024-01-15 10:00Z",
  "2024-01-15T10Z",
  "2024-01-15TZ",
  "2024-01-15T",
  "2024-01-15T10:00:00Z ",
  " 2024-01-15",
  "2024-01-15\n",
  "2024-01-15T24:00Z",
  "2024-01-15T24:00:00.000Z",
  "2024-01-15T24:00:01Z",
  "2024-01-15T23:60Z",
  "2024-01-15T23:59:60Z",
  "2024-01-15T23:59:59.999Z",
  "2024-01-15T10:00+01:00",
  "2024-01-15T10:00-01:00",
  "2024-01-15T10:00+00:00",
  "2024-01-15T10:00-00:00",
  "2024-01-15T10:00+05:30",
  "2024-01-15T10:00+14:00",
  "2024-01-15T10:00-12:00",
  "2024-01-15T10:00+23:59",
  "2024-01-15T10:00+24:00",
  "2024-01-15T10:00+23:60",
  "2024-01-15T10:00+2300",
  "2024-01-15T10:00+23",
  "2024-01-15T10:00+1:00",
  "2024-01-15T00:00Z+01:00",
  "2024-01-15T10:00:00.000+01:00",
  "2024-01-15T10:00 +01:00",
  "2024-01-15T10:00UTC",
  "2024-01-15T10:00GMT",
  "2024T10:00Z",
  "2024-01T10:00Z",
  "2024T10:00",
  "0000",
  "0000-01-01",
  "0000-01-01T00:00:00.000Z",
  "0099-01-01",
  "0001-01-01",
  "9999-12-31T23:59:59.999Z",
  "+000000",
  "-000000",
  "-000000-01-01T00:00:00Z",
  "+000001-01-01",
  "-000001-01-01",
  "-000001-12-31T23:59:59.999Z",
  "+002024-01-15",
  "-002024-01-15",
  "+010000-01-01T00:00:00.000Z",
  "+275760-09-13",
  "+275760-09-13T00:00:00.000Z",
  "+275760-09-13T00:00:00.001Z",
  "+275760-09-14",
  "+275760-09-13T00:00:00-00:01",
  "+275760-09-13T01:00+01:00",
  "+275760-09-13T00:59:59.999+01:00",
  "+275760-09-13T01:00:00.001+01:00",
  "+275760-09-13T00:59+01:00",
  "+275760-09-13T01:01+01:00",
  "+275760-09-13T00:00:00.001+00:01",
  "+275760-09-13T00:01+00:01",
  "+275760-09-13T00:02+00:01",
  "+275760-09-13T00:00+00:00",
  "+275760-09-13T00:00:00.001+00:00",
  "+275760-09-13T23:59:59.999+23:59",
  "+275760-09-14T00:00+23:59",
  "+275760-09-13T00:00:00.000-00:01",
  "+275760-09-12T23:59:59.999-00:00",
  "+275760-09-12T23:59-00:01",
  "+275760-09-12T23:58-00:01",
  "-271821-04-20",
  "-271821-04-20T00:00:00.000Z",
  "-271821-04-19T23:59:59.999Z",
  "-271821-04-19",
  "-271821-04-20T00:00:00+01:00",
  "-271821-04-19T23:00-01:00",
  "-271821-04-19T23:00:00.001-01:00",
  "-271821-04-19T22:59:59.999-01:00",
  "-271821-04-19T23:01-01:00",
  "-271821-04-19T22:59-01:00",
  "-271821-04-19T23:59:59.999-00:01",
  "-271821-04-19T23:59-00:01",
  "-271821-04-19T23:58-00:01",
  "-271821-04-20T00:00-00:00",
  "-271821-04-19T23:59:59.999+00:00",
  "-271821-04-19T00:00:00.001-23:59",
  "-271821-04-19T00:01-23:59",
  "-271821-04-20T00:00:00.001+00:01",
  "-271821-04-20T00:01+00:01",
  "-271821-04-20T00:02+00:01",
  "+999999-12-31T23:59:59.999Z",
  "-999999-01-01",
  "+2024",
  "-2024",
  "+02024-01-01",
  "+0002024-01-01",
  "12024-01-01",
  "１９９９",
  "２０２４-01-01",
  "1970-01-01T00:00:00.000Z",
  "1970-01-01",
  "1969-12-31T23:59:59.999Z",
  "1970",
  "Jan 15 2024",
  "15 January 2024 10:00 UTC",
  "Mon, 15 Jan 2024 10:00:00 GMT",
  "2024/01/15",
  "01/15/2024",
  "2024-01-15T10:00:00.000Z[UTC]",
  "2024-W03-1",
  "2024-015",
  "Infinity",
  "NaN",
  "0",
  "1705312800000",
];

function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

const MAX = 8.64e15;

function randomTime(rand: () => number): number {
  const r = rand();
  if (r < 0.5) return Math.round((rand() * 2 - 1) * MAX);
  if (r < 0.75) return Math.round((rand() * 2 - 1) * 4e12);
  if (r < 0.9) {
    const year = Math.floor(rand() * 12000) - 1000;
    const edge = Date.UTC(2000, 0, 1) + (Date.UTC(year, 0, 1) - Date.UTC(2000, 0, 1));
    return edge + [-1, 0, 1, -86_400_000, 86_400_000][Math.floor(rand() * 5)]!;
  }
  return (rand() * 2 - 1) * 1e13;
}

function isoOf(t: number, rand: () => number): string {
  const iso = new Date(t).toISOString();
  const r = rand();
  if (r < 0.2) return iso;
  if (r < 0.3) return iso.slice(0, -5) + "Z";
  if (r < 0.4) return iso.slice(0, -8) + "Z";
  if (r < 0.5) return iso.slice(0, iso.indexOf("T"));
  if (r < 0.55) return iso.slice(0, iso.indexOf("T") - 3);
  if (r < 0.6) return iso.slice(0, iso.indexOf("T") - 6);
  if (r < 0.85) {
    const sign = rand() < 0.5 ? "+" : "-";
    return iso.slice(0, -1) + `${sign}${pad(Math.floor(rand() * 24), 2)}:${pad(Math.floor(rand() * 60), 2)}`;
  }
  return iso.slice(0, -1);
}

function fieldSoup(rand: () => number): string {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const int = (low: number, high: number): number => low + Math.floor(rand() * (high - low + 1));
  const year =
    rand() < 0.7
      ? pad(int(0, 9999), 4)
      : pick(["+", "-"]) + pad(rand() < 0.2 ? pick([0, 275760, 271821, 275761, 271822]) : int(0, 999999), 6);
  let s = year;
  const parts = rand();
  if (parts > 0.15) s += "-" + pad(int(0, 13), 2);
  if (parts > 0.3) s += "-" + pad(int(0, 32), rand() < 0.05 ? 1 : 2);
  if (rand() < 0.65) {
    s += rand() < 0.9 ? "T" : pick(["t", " "]);
    s += pad(int(0, 25), 2) + ":" + pad(int(0, 61), 2);
    if (rand() < 0.6) {
      s += ":" + pad(int(0, 61), 2);
      if (rand() < 0.5) s += "." + (rand() < 0.8 ? pad(int(0, 999), 3) : String(int(0, 99_999)).slice(0, int(1, 5)));
    }
    const zone = rand();
    if (zone < 0.35) s += rand() < 0.95 ? "Z" : "z";
    else if (zone < 0.8) s += pick(["+", "-"]) + pad(int(0, 25), 2) + (rand() < 0.95 ? ":" : "") + pad(int(0, 61), 2);
  }
  return s;
}

function mutated(s: string, rand: () => number): string {
  const at = Math.floor(rand() * (s.length + 1));
  const r = rand();
  if (r < 0.3) return s.slice(0, at) + s.slice(at + 1);
  if (r < 0.6) return s.slice(0, at) + "0123456789-:T.Z+ "[Math.floor(rand() * 17)] + s.slice(at);
  if (r < 0.8) return s.slice(0, at) + s.slice(at, at + 1).toLowerCase() + s.slice(at + 1);
  return rand() < 0.5 ? ` ${s}` : `${s} `;
}

/** The time values written by hand: fractions, both edges of the range and beyond, `NaN` and the infinities. */
export const HAND_TIMES = [
  0, -0, 1, -1, 0.5, -0.5, 1.9, -1.9, 999, 1000, -999, -1000, 86_399_999, 86_400_000, -86_400_000, -86_400_001,
  MAX, -MAX, MAX + 1, -MAX - 1, MAX - 0.5, 9e15, -9e15, 2 ** 53, -(2 ** 53), 1e300, -1e300, 5e-324, NaN, Infinity, -Infinity,
  -62_198_755_200_000, -62_198_755_200_001, -62_167_219_200_000, -62_167_219_200_001, 253_402_300_799_999, 253_402_300_800_000,
  951_782_400_000, 951_868_799_999, 1_709_164_800_000, -2_203_891_200_000, 1_705_312_800_000, 4_102_444_800_000, -12_219_292_800_000,
];

/** The parts for `Date.UTC` written by hand: two-digit years, fractions, parts carried into the next,
 * both edges of the range and beyond, what is not finite, and the years and months V8 computes by
 * rules of its own. */
export const HAND_UTC: number[][] = [
  [2024], [2024, 0], [2024, 1, 29], [2023, 1, 29], [2000, 1, 29], [1900, 1, 29], [1600, 1, 29], [1969, 11, 31, 23, 59, 59, 999],
  [99], [99.9], [0], [-0], [-0.5], [100], [-1], [-99], [1970, 0, 1, 0, 0, 0, 0], [1970, 0, 1, 0, 0, 0, -1], [1970, 0, 1, 0, 0, 0, 0.5],
  [1970, 0, 1, 0, 0, 0, -0.5], [1970, 0, 1, 0, 0, 1, -0.5], [1970, 0, 1, 0, 0, -1, 0.5], [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5],
  [-1.5, -2.5, -3.5, -4.5, -5.5, -6.5, -7.5], [2024, 12], [2024, -1], [2024, -12], [2024, -13], [2024, 0, 0], [2024, 0, -1], [2024, 0, 32],
  [2024, 0, 1, 24], [2024, 0, 1, -1], [2024, 0, 1, 0, 60], [2024, 0, 1, 0, 0, 60], [2024, 0, 1, 0, 0, 0, 1000], [275760, 8, 13],
  [275760, 8, 13, 0, 0, 0, 1], [275760, 8, 12, 24], [-271821, 3, 20], [-271821, 3, 19, 23, 59, 59, 999], [-271821, 3, 20, 0, 0, 0, -1],
  [NaN], [2024, NaN], [2024, 0, Infinity], [2024, 0, 1, -Infinity], [2024, 0, 1, 0, 0, 0, NaN], [Infinity], [-Infinity],
  [1e6], [-1e6], [1e6 + 0.5, 0, 1], [-1e6 - 0.5], [-1e6, 0, 365_000_000], [1e6, 0, -365_000_000], [1e6, 0, -365_242_500],
  [-399_999, 0, 146_000_000], [-399_998, -12, 146_000_000], [-400_000, 0, 146_000_000], [-399_999, -1, 146_000_000],
  [-500_000, 0, 182_000_000], [-2e6, 0, 7.3e8], [2e6, -2.4e7], [2e6, -2.4e7, 1], [-500_000], [-500_000, 0, 1e7], [-500_000, 0, 1e7 + 1],
  [2024, 1e7], [2024, 1e7 + 1], [2024, -1e7 - 1], [2024, -1e7], [1e7], [-1e7], [1e300], [2024, 0, 1e8], [1970, 0, 1e8], [1970, 0, 1e8 + 1],
  [1970, 0, 1, 1e300], [1970, 0, 1, 1e303], [1970, 0, 1, 1e303, -1e305], [1970, 0, 1, 0, 0, 0, 8.64e15], [1970, 0, 1, 0, 0, 0, 8.64e15 + 1],
  [1970, 0, 1, 0, 0, 0, -8.64e15], [2024, 1, 1e17, 0, 0, 0, -8.64e24], [2 ** 53 + 2], [2 ** 31, 0], [-(2 ** 31) - 1, 0],
  [1970, 2 ** 31], [1970, 0, 2 ** 31], [1970, 0, 1, 2 ** 31], [5e-324], [-5e-324, -5e-324],
];

function randomUtc(rand: () => number): number[] {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const int = (low: number, high: number): number => low + Math.floor(rand() * (high - low + 1));
  const fraction = (x: number): number => (rand() < 0.15 ? x + pick([0.5, -0.5, 0.25, 0.999, -0.999]) : x);
  const part = (small: () => number, wide: number): number => {
    const r = rand();
    if (r < 0.02) return pick([NaN, Infinity, -Infinity]);
    if (r < 0.12) return fraction(Math.round((rand() * 2 - 1) * wide));
    return fraction(small());
  };
  const year = (): number => {
    const r = rand();
    if (r < 0.15) return int(0, 99);
    if (r < 0.6) return int(1000, 3000);
    if (r < 0.85) return int(-275_000, 275_000);
    return pick([1, -1]) * int(270_000, 2_000_000);
  };
  const parts = [part(year, 3e6), part(() => int(-30, 30), 3e7), part(() => int(-400, 400), 8e8), part(() => int(-30, 30), 1e13), part(() => int(-90, 90), 1e15), part(() => int(-90, 90), 1e16), part(() => int(-2000, 2000), 1e17)];
  return parts.slice(0, int(1, 7));
}

/** Every `[op, input]` of `dates.json`, the same on every run: strings for `Date.parse`, written by
 * hand and drawn from the date time string format and the forms around it, numbers for
 * `new Date(x)`, the methods read from the date and `JSON.stringify` of it, and the parts of
 * `Date.UTC`, written by hand and drawn, joined with commas. */
export function dateCases(): [string, string][] {
  const rand = prng(20261018);
  const strings = new Set(HAND_STRINGS);
  for (let i = 0; i < 700; i++) strings.add(isoOf(randomTime(rand) % MAX, rand));
  for (let i = 0; i < 700; i++) strings.add(fieldSoup(rand));
  for (let i = 0; i < 300; i++) strings.add(mutated(rand() < 0.5 ? fieldSoup(rand) : new Date(Math.round(randomTime(rand) % MAX)).toISOString(), rand));
  const times = [...HAND_TIMES, ...Array.from({ length: 360 }, () => randomTime(rand))];
  const utc = [...HAND_UTC, ...Array.from({ length: 900 }, () => randomUtc(rand))];
  const text = (x: number): string => (Object.is(x, -0) ? "-0" : String(x));
  return [
    ...[...strings].map((s): [string, string] => ["parse", s]),
    ...times.flatMap((x) => ["Date", ...DATE_METHODS, "stringify"].map((op): [string, string] => [op, text(x)])),
    ...utc.map((parts): [string, string] => ["UTC", parts.map(text).join(",")]),
  ];
}
