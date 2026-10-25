import { type N, type Scope, type Ty, type Val, fail, FLOAT, kept, nothing, refusalAt, STR } from "../model.ts";
import { type Plugin } from "../plugin.ts";
import { bare, strArg } from "../parens.ts";
import { asF64, compare, numberVal } from "../numbers.ts";
import { describeTy, expr } from "../expr.ts";

declare module "../model.ts" {
  interface PluginTys {
    date: { k: "date" };
  }
}

const GUIDE = "see the `dates_and_prices` guide";

const PORTABLE = /^([+-]\d{6}|\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{3})?)?(Z|[+-](\d{2}):(\d{2}))?)?$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** The time value `Date.parse(s)` gives a string every JavaScript engine reads alike: one in
 * ECMAScript's date time string format, a date alone or a date and time with a `Z` or an offset, its
 * fields within their ranges. `undefined` for any other string, which an engine may read by rules of
 * its own, or in the time zone of the machine running it, and for a date and time whose fields lie
 * beyond ±8.64 × 10¹⁵ ms read as UTC while its offset brings it within, which Safari reads as an
 * invalid date and the other engines as a valid one. */
export function portableTime(s: string): number | undefined {
  const m = PORTABLE.exec(s);
  if (!m || m[1] === "-000000" || (m[4] !== undefined && m[7] === undefined)) return undefined;
  const [year, month, day, hours, minutes, seconds, , zoneHours, zoneMinutes] = m.slice(1).map((x) => (x === undefined ? undefined : Number(x)));
  const within = (x: number | undefined, low: number, high: number) => x === undefined || (x >= low && x <= high);
  const fields = [within(month, 1, 12), within(day, 1, daysInMonth(year!, month ?? 1)), within(hours, 0, 23), within(minutes, 0, 59), within(seconds, 0, 59), within(zoneHours, 0, 23), within(zoneMinutes, 0, 59)];
  if (!fields.every(Boolean)) return undefined;
  const t = Date.parse(s);
  const zone = m[7];
  if (zone !== undefined && zone !== "Z" && Number.isNaN(Date.parse(s.slice(0, -zone.length) + "Z")) && !Number.isNaN(t)) return undefined;
  return t;
}

const COMMON_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

function v8Day(year: number, month: number, date: number): number {
  const before = (y: number) => 365 * (y + 399_999) + Math.trunc((y + 399_999) / 4) - Math.trunc((y + 399_999) / 100) + Math.trunc((y + 399_999) / 400);
  let y = Math.trunc(year) + Math.trunc(Math.trunc(month) / 12);
  let m = Math.trunc(month) % 12;
  if (m < 0) [m, y] = [m + 12, y - 1];
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return before(y) - before(1970) + COMMON_DAYS[m]! + (leap && m >= 2 ? 1 : 0) - 1 + Math.trunc(date);
}

/** Whether `Date.UTC(...parts)` gives what every JavaScript engine gives. V8 reads a year beyond
 * ±1,000,000, a month beyond ±10,000,000, and a year before −399,999 once the month is carried into
 * it by rules of its own, which Firefox and Safari do not share, so those are portable only where
 * the date is invalid in every engine; and a part worth more than 2⁵³ ms that the others bring back
 * within the range of dates is rounded by Node otherwise than by the browsers. */
export function portableUtc(parts: readonly number[]): boolean {
  const [year = NaN, month = 0, date = 1, hours = 0, minutes = 0, seconds = 0, ms = 0] = parts;
  if (![year, month, date, hours, minutes, seconds, ms].every(Number.isFinite)) return true;
  const int = Math.trunc;
  const terms = [int(hours) * 3_600_000, int(minutes) * 60_000, int(seconds) * 1000];
  const time = terms[0]! + terms[1]! + terms[2]! + int(ms);
  if (!Number.isFinite(time)) return true;
  const y = int(year) >= 0 && int(year) <= 99 ? 1900 + int(year) : year;
  const carried = int(y) + Math.floor(int(month) / 12);
  if (!(Math.abs(y) <= 1e6 && Math.abs(month) <= 1e7 && carried >= -399_999)) {
    return Math.abs(carried) >= 399_999 && Math.abs(int(date)) <= 1e7 && Math.abs(time) <= 1e15;
  }
  const days = v8Day(y, month, date) * 86_400_000;
  const t = days + time;
  const largest = Math.max(Math.abs(days), ...terms.map(Math.abs));
  return !(Number.isFinite(t) && largest > 2 ** 53 && Math.abs(t) <= 8.64e15 + largest * 2 ** -50);
}

const UTC_DEFAULTS = ["0.0f64", "1.0f64", "0.0f64", "0.0f64", "0.0f64", "0.0f64"];

function fromParts(s: Scope, n: N): Val {
  const args: N[] = n.arguments;
  if (args.length < 1 || args.length > 7) return fail(s.comp, "FV1807", `\`Date.UTC()\` takes from one to seven numbers: a year, a month from 0 and the day, hours, minutes, seconds and milliseconds that follow (${GUIDE})`, n);
  const vals = args.map((a) => {
    const v = expr(s, a);
    if (v.ty.k !== "int" && v.ty.k !== "float") fail(s.comp, "FV1807", `\`Date.UTC()\` takes numbers that are present: this is ${describeTy(v.ty)}`, a);
    return v;
  });
  if (vals.every((v) => v.num !== undefined)) {
    const parts = vals.map((v) => v.num!);
    if (!portableUtc(parts)) {
      return fail(s.comp, "FV1808", `\`Date.UTC(${parts.join(", ")})\` is a date engines compute differently: V8 reads a year beyond ±1,000,000, a month beyond ±10,000,000 and a year before −399,999 by rules of its own, and Node rounds a part beyond 2⁵³ ms otherwise than the browsers (${GUIDE})`, n);
    }
    return numberVal(Date.UTC(...(parts as [number])), false);
  }
  const code = [...vals.map((v) => bare(asF64(v))), ...UTC_DEFAULTS.slice(vals.length - 1)].join(", ");
  return { code: kept(`fv::date::try_date_utc(${code})`, refusalAt(s.comp, n)), ty: FLOAT };
}

const LOCAL_GETTERS = new Map([
  ["getFullYear", "getUTCFullYear"],
  ["getYear", "getUTCFullYear"],
  ["getMonth", "getUTCMonth"],
  ["getDate", "getUTCDate"],
  ["getDay", "getUTCDay"],
  ["getHours", "getUTCHours"],
  ["getMinutes", "getUTCMinutes"],
  ["getSeconds", "getUTCSeconds"],
  ["getMilliseconds", "getUTCMilliseconds"],
]);

const UTC_GETTERS = new Map([
  ["getUTCFullYear", "full_year"],
  ["getUTCMonth", "month"],
  ["getUTCDate", "date"],
  ["getUTCDay", "day"],
  ["getUTCHours", "hours"],
  ["getUTCMinutes", "minutes"],
  ["getUTCSeconds", "seconds"],
  ["getUTCMilliseconds", "milliseconds"],
]);

const LOCALE_METHODS = new Set(["toLocaleString", "toLocaleDateString", "toLocaleTimeString", "localeCompare"]);

const DATE: Val["ty"] = { k: "date" };

function global(s: Scope, n: N, name: string): boolean {
  return n?.type === "Identifier" && n.name === name && !s.locals.has(name) && !s.setup.has(name);
}

function rootOf(n: N): N {
  while (n?.type === "MemberExpression" || n?.type === "CallExpression" || n?.type === "NewExpression") n = n.type === "MemberExpression" ? n.object : n.callee;
  return n;
}

/** The refusal of anything that formats by locale, which `Intl` decides from data each engine ships. */
export function localeRefusal(s: Scope, what: string, n: N): never {
  return fail(
    s.comp,
    "FV1805",
    `${what} formats by locale with \`Intl\`, whose output differs between Node, Chromium, Firefox and Safari: format the value in Rust and pass a string, or translate it with \`$t\` (${GUIDE})`,
    n,
  );
}

function parsed(s: Scope, arg: N, what: string, n: N): Val {
  if (arg.type === "StringLiteral") {
    const t = portableTime(arg.value);
    if (t === undefined) {
      fail(s.comp, "FV1803", `${what} of ${JSON.stringify(arg.value)}, which is not a date alone nor a date and time with a \`Z\` or an offset in ECMAScript's date time string format, so each browser may read it differently (${GUIDE})`, arg);
    }
    return numberVal(t, false);
  }
  const v = expr(s, arg);
  if (v.ty.k !== "str") return fail(s.comp, "FV1802", `${what} takes a string that is present`, arg);
  return { code: kept(`fv::date::try_date_parse(${strArg(v.code)})`, refusalAt(s.comp, n)), ty: FLOAT };
}

function constructed(s: Scope, n: N): Val {
  const args: N[] = n.arguments;
  if (args.length === 0) return fail(s.comp, "FV1801", `\`new Date()\` is the time it runs, which differs between the server's render and the browser's hydration: pass the time as a prop (${GUIDE})`, n);
  if (args.length > 1) {
    return fail(s.comp, "FV1802", `\`new Date(year, month, …)\` reads its parts in the time zone of the machine running it: pass an ISO string with a \`Z\` or an offset, or a number of milliseconds (${GUIDE})`, n);
  }
  if (args[0].type === "StringLiteral") return { code: parsed(s, args[0], "`new Date()`", n).code, ty: DATE };
  const v = expr(s, args[0]);
  if (v.ty.k === "date") return v;
  if (v.ty.k === "str") return { code: kept(`fv::date::try_date_parse(${strArg(v.code)})`, refusalAt(s.comp, n)), ty: DATE };
  if (v.ty.k === "int" || v.ty.k === "float") return { code: `fv::date::js_time_clip(${bare(asF64(v))})`, ty: DATE };
  return fail(s.comp, "FV1802", `\`new Date()\` takes one string or one number that is present (${GUIDE})`, args[0]);
}

export const dates: Plugin = {
  name: "dates",
  construct(s, n) {
    if (global(s, rootOf(n.callee), "Intl")) return localeRefusal(s, "`Intl`", n);
    return global(s, n.callee, "Date") ? constructed(s, n) : null;
  },
  call(s, n) {
    const callee = n.callee;
    if (callee.type !== "MemberExpression" || callee.computed) return null;
    const method: string = callee.property.name;
    const object = callee.object;
    if (object.type === "Identifier" && object.name === "_ctx" && (method === "$d" || method === "$n")) return localeRefusal(s, `vue-i18n's \`${method}\``, n);
    const own = object.type === "Identifier" && (object.name === "_ctx" || object.name === "$setup");
    if (!own && LOCALE_METHODS.has(method)) return localeRefusal(s, `\`.${method}()\``, n);
    if (!global(s, object, "Date")) return null;
    if (method === "now") return fail(s.comp, "FV1801", `\`Date.now()\` is the time it runs, which differs between the server's render and the browser's hydration: pass the time as a prop (${GUIDE})`, n);
    if (method === "parse" && n.arguments.length === 1) return parsed(s, n.arguments[0], "`Date.parse()`", n);
    if (method === "UTC") return fromParts(s, n);
    return fail(s.comp, "FV1804", `\`Date.${method}()\` is not supported: build a date with \`new Date()\` of an ISO string or a number of milliseconds, or with \`Date.UTC()\` of its parts (${GUIDE})`, n);
  },
  method(s, target, method, args, n) {
    if (target.ty.k !== "date") return null;
    const t = bare(target.code);
    const plain = args.length === 0;
    if (plain && method === "toISOString") {
      const valid = target.num !== undefined && Number.isFinite(target.num);
      return { code: valid ? `&*fv::date::js_to_iso_string(${t})` : `&*${kept(`fv::date::try_to_iso_string(${t})`, refusalAt(s.comp, n))}`, ty: STR };
    }
    if (plain && method === "toUTCString") return { code: `&*fv::date::js_to_utc_string(${t})`, ty: STR };
    if (plain && method === "toJSON") return { code: `fv::date::js_to_json(${t}).as_deref()`, ty: { k: "opt", of: STR, none: "null" }, held: `fv::date::js_to_json(${t}).map(std::borrow::Cow::<str>::Owned)` };
    if (plain && (method === "getTime" || method === "valueOf")) return { code: target.code, ty: FLOAT };
    const utc = UTC_GETTERS.get(method);
    if (plain && utc !== undefined) return { code: `fv::date::js_utc_${utc}(${t})`, ty: FLOAT };
    if (LOCAL_GETTERS.has(method) || method === "getTimezoneOffset") {
      const instead = LOCAL_GETTERS.get(method);
      return fail(s.comp, "FV1804", `\`.${method}()\` reads the date in the time zone of the machine running it, which differs between the server and the reader's browser${instead ? `: use \`.${instead}()\`` : ""} (${GUIDE})`, n);
    }
    return fail(s.comp, "FV1804", `\`.${method}(${plain ? "" : "…"})\` on a \`Date\` is not supported: a date is read with \`.toISOString()\`, \`.toUTCString()\`, \`.toJSON()\`, \`.getTime()\` and the \`.getUTC…()\` methods (${GUIDE})`, n);
  },
  values: {
    order(a, op, b) {
      if (a.ty.k !== "date" || b.ty.k !== "date") return undefined;
      return compare({ code: a.code, ty: FLOAT }, op, { code: b.code, ty: FLOAT });
    },
    refuseEquality(s, a, b, n) {
      const dated = (ty: Ty) => ty.k === "date" || (ty.k === "opt" && ty.of.k === "date");
      if (!(dated(a.ty) || dated(b.ty)) || nothing(a.ty) || nothing(b.ty)) return;
      const why = dated(a.ty) && dated(b.ty)
        ? "is true only when the two are one object, so two dates of the same time are unequal"
        : "compares the date as an object, or as its `.toString()` in the time zone of the machine running it";
      fail(s.comp, "FV1809", `\`${n.operator}\` between ${describeTy(a.ty)} and ${describeTy(b.ty)} ${why}: compare time values, \`a.getTime() === b.getTime()\` (${GUIDE})`, n);
    },
    json: (v) => (v.ty.k === "date" ? `fv::date::js_json_date(${bare(v.code)})` : undefined),
    describe: (ty) => (ty.k === "date" ? "a `Date`" : undefined),
    unbindable: (ty) =>
      ty.k === "date" ? { what: "a `Date`", fix: "bind `.toISOString()`, or format it in Rust and pass a string" } : undefined,
  },
};
