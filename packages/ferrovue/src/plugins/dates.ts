import { type N, type Scope, type Val, fail, FLOAT, STR } from "../model.ts";
import { type Plugin } from "../plugin.ts";
import { bare, strArg } from "../parens.ts";
import { asF64, numberVal } from "../numbers.ts";
import { expr } from "../expr.ts";

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
 * its own, or in the time zone of the machine running it. */
export function portableTime(s: string): number | undefined {
  const m = PORTABLE.exec(s);
  if (!m || m[1] === "-000000" || (m[4] !== undefined && m[7] === undefined)) return undefined;
  const [year, month, day, hours, minutes, seconds, , zoneHours, zoneMinutes] = m.slice(1).map((x) => (x === undefined ? undefined : Number(x)));
  const within = (x: number | undefined, low: number, high: number) => x === undefined || (x >= low && x <= high);
  const fields = [within(month, 1, 12), within(day, 1, daysInMonth(year!, month ?? 1)), within(hours, 0, 23), within(minutes, 0, 59), within(seconds, 0, 59), within(zoneHours, 0, 23), within(zoneMinutes, 0, 59)];
  return fields.every(Boolean) ? Date.parse(s) : undefined;
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

function parsed(s: Scope, arg: N, what: string): Val {
  if (arg.type === "StringLiteral") {
    const t = portableTime(arg.value);
    if (t === undefined) {
      fail(s.comp, "FV1803", `${what} of ${JSON.stringify(arg.value)}, which is not a date alone nor a date and time with a \`Z\` or an offset in ECMAScript's date time string format, so each browser may read it differently (${GUIDE})`, arg);
    }
    return numberVal(t, false);
  }
  const v = expr(s, arg);
  if (v.ty.k !== "str") return fail(s.comp, "FV1802", `${what} takes a string that is present`, arg);
  return { code: `fv::js_date_parse(${strArg(v.code)})`, ty: FLOAT };
}

function constructed(s: Scope, n: N): Val {
  const args: N[] = n.arguments;
  if (args.length === 0) return fail(s.comp, "FV1801", `\`new Date()\` is the time it runs, which differs between the server's render and the browser's hydration: pass the time as a prop (${GUIDE})`, n);
  if (args.length > 1) {
    return fail(s.comp, "FV1802", `\`new Date(year, month, …)\` reads its parts in the time zone of the machine running it: pass an ISO string with a \`Z\` or an offset, or a number of milliseconds (${GUIDE})`, n);
  }
  if (args[0].type === "StringLiteral") return { code: parsed(s, args[0], "`new Date()`").code, ty: DATE };
  const v = expr(s, args[0]);
  if (v.ty.k === "date") return v;
  if (v.ty.k === "str") return { code: `fv::js_date_parse(${strArg(v.code)})`, ty: DATE };
  if (v.ty.k === "int" || v.ty.k === "float") return { code: `fv::js_time_clip(${bare(asF64(v))})`, ty: DATE };
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
    if (method === "parse" && n.arguments.length === 1) return parsed(s, n.arguments[0], "`Date.parse()`");
    return fail(s.comp, "FV1804", `\`Date.${method}()\` is not supported: build a date with \`new Date()\` of an ISO string or a number of milliseconds (${GUIDE})`, n);
  },
  method(s, target, method, args, n) {
    if (target.ty.k !== "date") return null;
    const t = bare(target.code);
    const plain = args.length === 0;
    if (plain && method === "toISOString") return { code: `&*fv::js_to_iso_string(${t})`, ty: STR };
    if (plain && (method === "getTime" || method === "valueOf")) return { code: target.code, ty: FLOAT };
    const utc = UTC_GETTERS.get(method);
    if (plain && utc !== undefined) return { code: `fv::js_utc_${utc}(${t})`, ty: FLOAT };
    if (LOCAL_GETTERS.has(method) || method === "getTimezoneOffset") {
      const instead = LOCAL_GETTERS.get(method);
      return fail(s.comp, "FV1804", `\`.${method}()\` reads the date in the time zone of the machine running it, which differs between the server and the reader's browser${instead ? `: use \`.${instead}()\`` : ""} (${GUIDE})`, n);
    }
    return fail(s.comp, "FV1804", `\`.${method}(${plain ? "" : "…"})\` on a \`Date\` is not supported: a date is read with \`.toISOString()\`, \`.getTime()\` and the \`.getUTC…()\` methods (${GUIDE})`, n);
  },
  values: {
    describe: (ty) => (ty.k === "date" ? "a `Date`" : undefined),
    unbindable: (ty) =>
      ty.k === "date" ? { what: "a `Date`", fix: "bind `.toISOString()`, or format it in Rust and pass a string" } : undefined,
  },
};
