import type { App } from "vue";
import { RouterLink, routeLocationKey, routerKey, type RouteLocationNormalized, type RouteLocationNormalizedLoaded, type RouteLocationRaw, type RouteLocationResolved, type Router } from "vue-router";
import type { RouteEntry } from "./route-records.ts";

/** What `linkRoutes` hands navigations to, and the router options of `ferrovue.config.json`. */
export interface LinkRoutesOptions {
  /** The application's own navigation, called with the `href` of every navigation (the base
   * included, as the link's `href` attribute has it) and the route it resolves to. */
  navigate: (href: string, to: RouteLocationNormalized) => void;
  /** The base, as `router.base` in `ferrovue.config.json` gives it. */
  base?: string;
  /** As `router.linkActiveClass` in `ferrovue.config.json`. */
  linkActiveClass?: string;
  /** As `router.linkExactActiveClass` in `ferrovue.config.json`. */
  linkExactActiveClass?: string;
  /** The location of the page, as an `href` with the base (the one `navigate` is given). The
   * browser's location by default. */
  location?: string;
}

/** A Vue plugin giving `<RouterLink>` and `useRoute()` the page's route, with no router. */
export interface LinkRoutes {
  /** Registers vue-router's `<RouterLink>` and provides the page's route to it, to `useRoute()`
   * and to `$route`. */
  install(app: App): void;
  /** `to` resolved as vue-router's `router.resolve(to)` resolves it on this page. */
  resolve(to: RouteLocationRaw): RouteLocationResolved;
  /** The page's route, as `useRoute()` gives it. */
  readonly route: RouteLocationNormalizedLoaded;
}

type Value = string | number | boolean | null | undefined | Value[];
type Values = Record<string, Value>;
interface Key {
  name: string;
  re: string;
  repeatable: boolean;
  optional: boolean;
}
type Token = string | Key;
interface RouteRecord {
  path: string;
  name: string | undefined;
  meta: object;
  aliasOf: undefined;
}
interface Matcher {
  re: RegExp;
  score: number[][];
  keys: Key[];
  segments: Token[][];
  record: RouteRecord;
  parent: Matcher | undefined;
  matchable: boolean;
}
interface Target {
  name?: string;
  path?: string;
  params?: Values;
  query?: Values;
  hash?: string;
}
interface Resolved {
  fullPath: string;
  path: string;
  query: Values;
  hash: string;
  name: string | undefined;
  params: Values;
  matched: RouteRecord[];
  meta: object;
  redirectedFrom: undefined;
  href?: string;
}

const isArray = Array.isArray;
const BASE_RE = "[^/]+?";

function tokenize(path: string): Token[][] {
  if (!path) return [[]];
  if (path === "/") return [[""]];
  if (path[0] !== "/") throw new Error(`Invalid path "${path}"`);
  const tokens: Token[][] = [];
  let segment: Token[] = [];
  let state = 0;
  let i = 0;
  let char = "";
  let buffer = "";
  let custom = "";
  const consume = (): void => {
    if (buffer) segment.push(state ? { name: buffer, re: custom, repeatable: char === "*" || char === "+", optional: char === "*" || char === "?" } : buffer);
    buffer = "";
  };
  const close = (): void => {
    consume();
    state = 0;
    if (char !== "*" && char !== "?" && char !== "+") i--;
  };
  while (i < path.length) {
    char = path[i++]!;
    if (state === 0) {
      if (char === "\\") state = 4;
      else if (char === "/") {
        consume();
        tokens.push(segment);
        segment = [];
      } else if (char === ":") {
        consume();
        state = 1;
      } else buffer += char;
    } else if (state === 4) {
      buffer += char;
      state = 0;
    } else if (state === 1) {
      if (char === "(") state = 2;
      else if (/\w/.test(char)) buffer += char;
      else close();
    } else if (state === 2) {
      if (char !== ")") custom += char;
      else if (custom.endsWith("\\")) custom = custom.slice(0, -1) + char;
      else state = 3;
    } else {
      close();
      custom = "";
    }
  }
  consume();
  tokens.push(segment);
  return tokens.slice(1);
}

function compareScores(a: number[], b: number[]): number {
  for (let i = 0; i < a.length && i < b.length; i++) if (b[i]! - a[i]!) return b[i]! - a[i]!;
  if (a.length < b.length) return a.length === 1 && a[0] === 80 ? -1 : 1;
  if (a.length > b.length) return b.length === 1 && b[0] === 80 ? 1 : -1;
  return 0;
}

const lastNegative = (score: number[][]): boolean => score.length > 0 && score.at(-1)!.at(-1)! < 0;

function compare(a: Matcher, b: Matcher): number {
  for (let i = 0; i < a.score.length && i < b.score.length; i++) {
    const c = compareScores(a.score[i]!, b.score[i]!);
    if (c) return c;
  }
  if (Math.abs(b.score.length - a.score.length) === 1) {
    if (lastNegative(a.score)) return 1;
    if (lastNegative(b.score)) return -1;
  }
  return b.score.length - a.score.length;
}

function matcherOf(record: RouteRecord, parent: Matcher | undefined, matchable: boolean): Matcher {
  const segments = tokenize(record.path);
  const score: number[][] = [];
  const keys: Key[] = [];
  let pattern = "^";
  for (const segment of segments) {
    const scores = segment.length ? [] : [90];
    segment.forEach((token, index) => {
      let s = 40;
      if (typeof token === "string") {
        if (!index) pattern += "/";
        pattern += token.replace(/[.+*?^${}()[\]/\\]/g, "\\$&");
        s += 40;
      } else {
        keys.push(token);
        const re = token.re || BASE_RE;
        let sub = token.repeatable ? `((?:${re})(?:/(?:${re}))*)` : `(${re})`;
        if (!index) sub = token.optional && segment.length < 2 ? `(?:/${sub})` : "/" + sub;
        if (token.optional) sub += "?";
        pattern += sub;
        s += (re === BASE_RE ? 20 : 30) - (token.optional ? 8 : 0) - (token.repeatable ? 20 : 0) - (re === ".*" ? 50 : 0);
      }
      scores.push(s);
    });
    score.push(scores);
  }
  return { re: new RegExp(pattern + "/?$", "i"), score, keys, segments, record, parent, matchable };
}

function stringify(matcher: Matcher, params: Values): string {
  let path = "";
  let avoid = false;
  for (const segment of matcher.segments) {
    if (!avoid || !path.endsWith("/")) path += "/";
    avoid = false;
    for (const token of segment) {
      if (typeof token === "string") {
        path += token;
        continue;
      }
      const param = token.name in params ? params[token.name] : "";
      if (isArray(param) && !token.repeatable) throw new Error(`Param "${token.name}" is not repeatable`);
      const text = isArray(param) ? param.join("/") : param;
      if (!text) {
        if (!token.optional) throw new Error(`Missing required param "${token.name}"`);
        if (segment.length < 2) {
          if (path.endsWith("/")) path = path.slice(0, -1);
          else avoid = true;
        }
      }
      path += text;
    }
  }
  return path || "/";
}

const encode = (text: Value, re: RegExp): string =>
  text == null ? "" : encodeURI(String(text)).replace(re, (m) => (m === "%20" ? "+" : m[0] === "%" ? decodeURIComponent(m) : encodeURIComponent(m)));
const encodeHash = (text: string): string => encode(text, /%(5B|5D|7C|7B|7D|5E)/g);
const encodeQueryValue = (text: Value): string => encode(text, /%(5B|5D|7C|7B|7D|5E|60|20)|[+#&]/g);
const encodeParam = (text: Value): string => encode(text, /%(5B|5D|7C)|[#?/]/g);

function decode(text: Value): string | null {
  if (text == null) return null;
  try {
    return decodeURIComponent(String(text));
  } catch {
    return String(text);
  }
}

const mapParams = (f: (value: Value) => Value, params: Values): Values => {
  const out: Values = {};
  for (const key in params) {
    const value = params[key];
    out[key] = isArray(value) ? value.map(f) : f(value);
  }
  return out;
};

function parseQuery(search: string): Values {
  const query: Values = {};
  if (search === "" || search === "?") return query;
  for (const part of (search[0] === "?" ? search.slice(1) : search).split("&")) {
    const param = part.replace(/\+/g, " ");
    const eq = param.indexOf("=");
    const key = decode(eq < 0 ? param : param.slice(0, eq))!;
    const value = eq < 0 ? null : decode(param.slice(eq + 1));
    if (key in query) {
      let current = query[key];
      if (!isArray(current)) current = query[key] = [current];
      current.push(value);
    } else query[key] = value;
  }
  return query;
}

function stringifyQuery(query: Values): string {
  let search = "";
  for (const raw in query) {
    const value = query[raw];
    const key = encode(raw, /%(5B|5D|7C|7B|7D|5E|60|20)|[+#&=]/g);
    if (value == null) {
      if (value !== undefined) search += (search.length ? "&" : "") + key;
      continue;
    }
    for (const v of isArray(value) ? value.map((x) => x && encodeQueryValue(x)) : [value && encodeQueryValue(value)]) {
      if (v !== undefined) {
        search += (search.length ? "&" : "") + key;
        if (v != null) search += "=" + String(v);
      }
    }
  }
  return search;
}

function normalizeQuery(query: Values | undefined): Values {
  const out: Values = {};
  for (const key in query) {
    const value = query[key];
    if (value !== undefined) out[key] = isArray(value) ? value.map((v) => (v == null ? null : String(v))) : value == null ? value : String(value);
  }
  return out;
}

function resolveRelativePath(to: string, from: string): string {
  if (to.startsWith("/")) return to;
  if (!to) return from;
  const fromSegments = from.split("/");
  const toSegments = to.split("/");
  const last = toSegments.at(-1);
  if (last === ".." || last === ".") toSegments.push("");
  let position = fromSegments.length - 1;
  let index = 0;
  for (; index < toSegments.length; index++) {
    const segment = toSegments[index];
    if (segment === ".") continue;
    if (segment !== "..") break;
    if (position > 1) position--;
  }
  return fromSegments.slice(0, position).join("/") + "/" + toSegments.slice(index).join("/");
}

function parseURL(location: string, current: string): { fullPath: string; path: string; query: Values; hash: string } {
  let path: string | undefined;
  let query: Values = {};
  let search = "";
  let hash = "";
  const hashPos = location.indexOf("#");
  let searchPos = location.indexOf("?");
  if (hashPos >= 0 && searchPos > hashPos) searchPos = -1;
  if (searchPos >= 0) {
    path = location.slice(0, searchPos);
    search = location.slice(searchPos, hashPos > 0 ? hashPos : location.length);
    query = parseQuery(search.slice(1));
  }
  if (hashPos >= 0) {
    path ||= location.slice(0, hashPos);
    hash = location.slice(hashPos);
  }
  path = resolveRelativePath(path ?? location, current);
  return { fullPath: path + search + hash, path, query, hash: decode(hash)! };
}

function normalizeBase(base: string | undefined): string {
  if (!base) {
    base = (typeof document !== "undefined" && document.querySelector("base")?.getAttribute("href")) || "/";
    base = base.replace(/^\w+:\/\/[^/]+/, "");
  }
  if (base[0] !== "/" && base[0] !== "#") base = "/" + base;
  return base.replace(/\/$/, "");
}

const START: Resolved = { path: "/", name: undefined, params: {}, query: {}, hash: "", fullPath: "/", matched: [], meta: {}, redirectedFrom: undefined };

/** `<RouterLink>` and `useRoute()` for an application whose own navigation layer leaves the page,
 * with no router: a plugin that registers vue-router's `<RouterLink>` and gives it, `useRoute()`
 * and `$route` the page's route, resolved from the routes file the compiler reads as vue-router
 * resolves it. A link's click, the link to the current page included, is handed to `navigate`.
 * Build one for each page the application shows. */
export function linkRoutes(routes: RouteEntry[], options: LinkRoutesOptions): LinkRoutes {
  const matchers: Matcher[] = [];
  const named = new Map<string, Matcher>();
  const add = (entry: RouteEntry, parent?: Matcher): void => {
    const raw = typeof entry === "string" ? { path: entry } : entry;
    let path = raw.path;
    if (parent && path[0] !== "/") {
      const above = parent.record.path;
      path = above + (path && (above.endsWith("/") ? "" : "/") + path);
    }
    const name = raw.name || undefined;
    const matcher = matcherOf({ path, name, meta: {}, aliasOf: undefined }, parent, !!name || (raw as { view?: boolean }).view !== false);
    if (matcher.matchable) {
      let lower = 0;
      let upper = matchers.length;
      while (lower !== upper) {
        const mid = (lower + upper) >> 1;
        if (compare(matcher, matchers[mid]!) < 0) upper = mid;
        else lower = mid + 1;
      }
      for (let above = parent; above; above = above.parent) {
        if (above.matchable && !compare(matcher, above)) {
          upper = matchers.lastIndexOf(above, upper - 1);
          break;
        }
      }
      matchers.splice(upper, 0, matcher);
      if (name) named.set(name, matcher);
    }
    for (const child of (raw as { children?: RouteEntry[] }).children ?? []) add(child, matcher);
  };
  for (const entry of routes) add(entry);

  const pick = (params: Values, keys: Key[]): Values => {
    const out: Values = {};
    for (const { name } of keys) if (name in params) out[name] = params[name];
    return out;
  };
  const match = (location: Target, current: Resolved): Omit<Resolved, "fullPath" | "query" | "hash" | "redirectedFrom"> => {
    let matcher: Matcher | undefined;
    let params: Values = {};
    let path: string;
    if (location.name) {
      matcher = named.get(location.name);
      if (!matcher) throw new Error(`No match for ${JSON.stringify(location)}`);
      params = Object.assign(
        pick(current.params, matcher.keys.filter((k) => !k.optional).concat(matcher.parent?.keys.filter((k) => k.optional) ?? [])),
        location.params && pick(location.params, matcher.keys),
      );
      path = stringify(matcher, params);
    } else if (location.path != null) {
      path = location.path;
      matcher = matchers.find((m) => m.re.test(path));
      if (matcher) {
        const found = path.match(matcher.re)!;
        matcher.keys.forEach((key, i) => {
          const value = found[i + 1] || "";
          params[key.name] = value && key.repeatable ? value.split("/") : value;
        });
        for (const key of matcher.keys) if (key.optional && !params[key.name]) delete params[key.name];
      }
    } else {
      matcher = current.name ? named.get(current.name) : matchers.find((m) => m.re.test(current.path));
      if (!matcher) throw new Error(`No match for ${JSON.stringify(location)}`);
      params = Object.assign({}, current.params, location.params);
      path = stringify(matcher, params);
    }
    const matched: RouteRecord[] = [];
    for (let m = matcher; m; m = m.parent) matched.unshift(m.record);
    return { name: matcher?.record.name, path, params, matched, meta: {} };
  };

  const base = normalizeBase(options.base);
  const href = (fullPath: string): string => base.replace(/^[^#]+#/, "#") + fullPath;
  let current = START;
  const resolve = (to: RouteLocationRaw | Target): Resolved => {
    if (typeof to === "string") {
      const location = parseURL(to, current.path);
      const matched = match({ path: location.path }, current);
      return { ...location, ...matched, params: mapParams(decode, matched.params), redirectedFrom: undefined, href: href(location.fullPath) };
    }
    const raw = to as Target;
    const at = { ...current };
    let location: Target;
    if (raw.path != null) location = { ...raw, path: parseURL(raw.path, current.path).path };
    else {
      const params = { ...raw.params };
      for (const key in params) if (params[key] == null) delete params[key];
      location = { ...raw, params: mapParams(encodeParam, params) };
      at.params = mapParams(encodeParam, at.params);
    }
    const matched = match(location, at);
    const hash = raw.hash || "";
    matched.params = mapParams(String, mapParams(decode, matched.params));
    const query = raw.query ? stringifyQuery(raw.query) : "";
    const fullPath = matched.path + (query && "?") + query + encodeHash(hash);
    return { fullPath, hash, query: normalizeQuery(raw.query), ...matched, redirectedFrom: undefined, href: href(fullPath) };
  };

  const page = options.location ?? window.location.pathname + window.location.search + window.location.hash;
  const end = page.search(/[?#]/);
  const pathname = end < 0 ? page : page.slice(0, end);
  current = resolve((base && pathname.toLowerCase().startsWith(base.toLowerCase()) ? pathname.slice(base.length) || "/" : pathname) + (end < 0 ? "" : page.slice(end)));
  const route: Record<string, unknown> = {};
  for (const key in START) route[key] = current[key as keyof Resolved];
  const go = async (to: RouteLocationRaw | Target): Promise<undefined> => {
    const target = resolve(to);
    options.navigate(target.href!, target as unknown as RouteLocationNormalized);
  };
  const router = {
    currentRoute: { value: current },
    options: { linkActiveClass: options.linkActiveClass, linkExactActiveClass: options.linkExactActiveClass },
    resolve,
    push: go,
    replace: (to: RouteLocationRaw) => go(typeof to === "string" ? parseURL(to, current.path) : to),
  };
  return {
    route: route as unknown as RouteLocationNormalizedLoaded,
    resolve: resolve as (to: RouteLocationRaw) => RouteLocationResolved,
    install(app) {
      app.component("RouterLink", RouterLink);
      app.config.globalProperties.$route = current as never;
      app.provide(routerKey, router as unknown as Router);
      app.provide(routeLocationKey, route as unknown as RouteLocationNormalizedLoaded);
    },
  };
}
