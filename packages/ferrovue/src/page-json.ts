/** JSON as the server writes it into a page: with the bare `NaN`, `Infinity` and `-Infinity` that
 * `JSON.parse` refuses, for numbers JSON cannot carry. */
const BARE = /"(?:[^"\\]|\\.)*"|-?Infinity|NaN/g;
const NON_FINITE: Record<string, number> = { NaN: Number.NaN, Infinity: Number.POSITIVE_INFINITY, "-Infinity": Number.NEGATIVE_INFINITY };

export function parseJson(text: string): unknown {
  if (!/NaN|Infinity/.test(text)) return JSON.parse(text);
  let escaped = "\\u0000";
  while (text.includes(escaped)) escaped += "\\u0000";
  const tag = JSON.parse(`"${escaped}"`) as string;
  const quoted = text.replace(BARE, (match) => (match.startsWith('"') ? match : `"${escaped}${match}"`));
  return JSON.parse(quoted, (_key, value: unknown) => (typeof value === "string" && value.startsWith(tag) ? NON_FINITE[value.slice(tag.length)] : value));
}
