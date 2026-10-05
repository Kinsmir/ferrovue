import { type Component, type N, type Scope, type Ty, type Val, BOOL, fail, FLOAT, GenError, INT, opt, rustStr, sameTy, snake, STR, UNDEF } from "./model.ts";
import { ctx } from "./context.ts";
import { lookupStruct, markHome } from "./typescript.ts";
import { claim } from "./plugin.ts";
import { atom, bare, binary, enclosed, logical, negate, not, occurrences, receiver, strArg } from "./parens.ts";
import { collected } from "./lists.ts";
import { asCow, formatted, isTemporary, loneOf, meet, unquote } from "./strings.ts";
import { arithmetic, asF64, compare, intFromF64, isNumber, negatedOrder, numberVal } from "./numbers.ts";
import { boolOf, choice, known, narrowing, narrowTo, pathOf, presence, truthy } from "./narrowing.ts";
import { call, isObjectCall } from "./calls.ts";

export function describeTy(ty: Ty): string {
  switch (ty.k) {
    case "str":
      return "a string";
    case "int":
      return "a number";
    case "float":
      return "a number";
    case "bool":
      return "a boolean";
    case "list":
      return "a list";
    case "record":
      return "a record";
    case "struct":
    case "child":
      return "an object";
    case "opt":
      return `an optional ${describeTy(ty.of).replace(/^an? /, "")}`;
    case "undef":
      return "`undefined`";
    default:
      return claim((p) => p.values?.describe?.(ty)) ?? "a value of another kind";
  }
}

export function fieldVal(comp: Component, base: string, ty: Ty, js: string, node: N): Val {
  if (ty.k !== "struct") fail(comp, `\`.${js}\` on a value that is not an object`, node);
  const { st, owner } = lookupStruct(comp, ty);
  const found = st?.fields.find((x) => x.js === js);
  if (!found) fail(comp, `\`${ty.name}\` has no field \`${js}\``, node);
  const f = owner === comp ? found : { ...found, ty: markHome(found.ty, owner.name) };
  if (st!.slot) return { code: `${base}.${f.rust}`, ty: f.ty };
  const place = `${base}.${f.rust}`;
  if (f.dflt !== undefined && f.ty.k === "opt") {
    const of = f.ty.of;
    if (of.k === "str") return { code: `${place}.as_deref().unwrap_or(${f.dflt})`, ty: STR };
    if (of.k === "list") return { code: `${place}.as_deref().unwrap_or(${f.dflt})`, ty: of };
    return { code: `${place}.unwrap_or(${f.dflt})`, ty: of };
  }
  switch (f.ty.k) {
    case "str":
      return { code: `&*${place}`, ty: STR };
    case "html":
    case "child":
      return { code: `&${place}`, ty: f.ty };
    case "opt":
      if (f.ty.of.k === "html") return { code: `${place}.as_ref()`, ty: f.ty };
      if (f.ty.of.k === "str") return { code: `${place}.as_deref()`, ty: f.ty };
      if (f.ty.of.k === "int" || f.ty.of.k === "float" || f.ty.of.k === "bool") return { code: place, ty: f.ty };
      return { code: `${place}.as_ref()`, ty: f.ty };
    default:
      return { code: place, ty: f.ty };
  }
}

export function coerce(comp: Component, v: Val, want: Ty, node: N): string {
  if (sameTy(v.ty, want)) return v.code;
  if (want.k === "opt" && v.ty.k === "undef") return "None";
  if (want.k === "opt" && sameTy(v.ty, want.of)) return `Some(${bare(v.code)})`;
  if (want.k === "float" && v.ty.k === "int") return asF64(v);
  if (want.k === "opt" && want.of.k === "float" && v.ty.k === "int") return `Some(${asF64(v)})`;
  return fail(comp, `a ${JSON.stringify(v.ty)} where ${JSON.stringify(want)} is expected`, node);
}

export function childOf(name: string): Component {
  const c = ctx.components.get(name);
  if (!c) throw new GenError(`\`Props\` is imported from ${name}.vue, which is not among the components compiled`);
  return c;
}

export function expr(s: Scope, n: N): Val {
  const comp = s.comp;
  const path = pathOf(n);
  if (path !== null) {
    const narrowed = s.narrowed.get(path);
    if (narrowed) return narrowed;
  }
  if (n.type === "MemberExpression" && !n.computed && n.property.type === "Identifier" && n.property.name === "length") {
    if (isObjectCall(n.object, "entries") && n.object.arguments.length === 1) {
      const r = expr(s, n.object.arguments[0]);
      if (r.ty.k === "record") return { code: `${atom(r.code)}.len() as i64`, ty: INT };
    }
    const base = expr(s, n.object);
    if (base.ty.k === "list" && base.iter !== undefined) {
      const vec = /^(.*)\.into_iter\(\)$/s.exec(base.iter)?.[1];
      if (vec === undefined) {
        const at = base.iter.lastIndexOf(".map(");
        const mapped = at > 0 && enclosed(base.iter.slice(at + 4)) ? base.iter.slice(0, at) : base.iter;
        const held = /^(.*)\.iter\(\)$/s.exec(mapped)?.[1];
        return { code: held !== undefined ? `${atom(held)}.len() as i64` : `${atom(mapped)}.count() as i64`, ty: INT };
      }
      return { code: vec !== undefined ? `${atom(vec)}.len() as i64` : `${atom(base.iter)}.count() as i64`, ty: INT };
    }
    if (base.ty.k === "list") return { code: `${atom(base.code)}.len() as i64`, ty: INT };
    if (base.ty.k === "str") return { code: `fv::js_length(${strArg(base.code)})`, ty: INT };
  }
  if (n.type === "BinaryExpression" && n.operator === "+") {
    const a = expr(s, n.left);
    const b = expr(s, n.right);
    const joinable = (t: Ty) => t.k === "str" || isNumber(t);
    if ((a.ty.k === "str" || b.ty.k === "str") && joinable(a.ty) && joinable(b.ty)) {
      meet(comp, a, b, "`+`", n, "join");
      return formatted(comp, [a, b], n, "`+`");
    }
    if (isNumber(a.ty) && isNumber(b.ty)) return arithmetic(a, "+", b, a.ty.k === "int" && b.ty.k === "int");
    return fail(comp, "`+` joins a string to a string or a number, or adds two numbers", n);
  }
  if (n.type === "BinaryExpression" && ["-", "*", "%", "/", "<", ">", "<=", ">="].includes(n.operator)) {
    const a = expr(s, n.left);
    const b = expr(s, n.right);
    const comparison = ["<", ">", "<=", ">="].includes(n.operator);
    if (comparison && a.ty.k === "str" && b.ty.k === "str") {
      meet(comp, a, b, `\`${n.operator}\``, n, "order");
      const is = { "<": "lt", ">": "gt", "<=": "le", ">=": "ge" }[n.operator as "<"];
      return { code: `fv::js_cmp(${strArg(a.code)}, ${strArg(b.code)}).is_${is}()`, ty: BOOL };
    }
    if (!isNumber(a.ty) || !isNumber(b.ty)) {
      const why =
        a.ty.k === "opt" || b.ty.k === "opt"
          ? "narrow an optional one with `v-if` first"
          : `the other is ${describeTy(isNumber(a.ty) ? b.ty : a.ty)}`;
      const between = comparison ? "two numbers, or two strings," : "two numbers";
      return fail(comp, `\`${n.operator}\` is supported between ${between} that are present: ${why}`, n);
    }
    if (["<", ">", "<=", ">="].includes(n.operator)) return compare(a, n.operator, b);
    const intDivisor = n.right.type === "NumericLiteral" && Number.isInteger(n.right.value) && n.right.value !== 0;
    const int = a.ty.k === "int" && b.ty.k === "int" && n.operator !== "/" && (n.operator !== "%" || intDivisor);
    return arithmetic(a, n.operator, b, int);
  }
  switch (n.type) {
    case "TemplateLiteral": {
      const parts: (string | Val)[] = [];
      n.quasis.forEach((q: N, i: number) => {
        parts.push(q.value.cooked as string);
        if (i < n.expressions.length) parts.push(expr(s, n.expressions[i]));
      });
      return formatted(comp, parts, n, "a template literal");
    }
    case "ArrayExpression": {
      if (n.elements.length === 0) return { code: "[]", ty: { k: "list", of: UNDEF } };
      const values = n.elements.map((el: N) => {
        if (!el || el.type === "SpreadElement") fail(comp, "an array literal holds plain values", n);
        return expr(s, el);
      });
      const of = values[0]!.ty;
      if (!(of.k === "str" || of.k === "int" || of.k === "float" || of.k === "bool") || values.some((v: Val) => !sameTy(v.ty, of))) {
        fail(comp, "an array literal holds strings, numbers or booleans, all of one type", n);
      }
      return { code: `[${values.map((v: Val) => bare(v.code)).join(", ")}]`, ty: { k: "list", of }, ...loneOf(...values) };
    }
    case "OptionalMemberExpression": {
      if (n.computed) return fail(comp, "computed member access", n);
      const base = expr(s, n.object);
      if (base.ty.k !== "opt") return fieldVal(comp, base.code, base.ty, n.property.name, n);
      const f = fieldVal(comp, "v", base.ty.of, n.property.name, n);
      if (f.ty.k === "opt") return { code: `${atom(base.code)}.and_then(|v| ${f.code})`, ty: f.ty };
      return { code: `${atom(base.code)}.map(|v| ${f.code})`, ty: opt(f.ty) };
    }
    case "StringLiteral":
      return { code: rustStr(n.value), ty: STR };
    case "NumericLiteral":
      return numberVal(n.value, Number.isSafeInteger(n.value));
    case "BooleanLiteral":
      return { code: String(n.value), ty: BOOL, konst: n.value };
    case "NullLiteral":
      return fail(comp, "`null`: compare with `undefined`, which is what an absent prop is", n);
    case "Identifier": {
      if (n.name === "undefined") return { code: "None", ty: UNDEF };
      const local = s.locals.get(n.name) ?? s.setup.get(n.name);
      if (local) return local;
      if (s.clientOnly.has(n.name)) {
        return fail(comp, `\`${n.name}\` is set up in a way the server cannot evaluate: ${s.clientOnly.get(n.name)}`, n);
      }
      if (n.name === s.propsIdent) return { code: "props", ty: { k: "struct", name: "Props" } };
      return fail(comp, `\`${n.name}\` is not available when rendering on the server`, n);
    }
    case "MemberExpression": {
      if (!n.computed && n.property.name === "value" && n.object.type === "Identifier" && s.refs.has(n.object.name) && !s.locals.has(n.object.name)) {
        return expr(s, n.object);
      }
      if (n.computed) {
        if (n.object.type === "Identifier" && n.object.name === "$setup" && n.property.type === "StringLiteral") {
          return expr(s, { ...n.property, type: "Identifier", name: n.property.value });
        }
        if (n.property.type === "StringLiteral") {
          const base = expr(s, n.object);
          const own = claim((p) => p.member?.(s, base, n.property.value, n, true));
          if (own) return own;
        }
        return fail(comp, "computed member access", n);
      }
      const prop = n.property.name as string;
      const slotsObject =
        (n.object.type === "Identifier" && n.object.name === "$slots") ||
        (n.object.type === "MemberExpression" && !n.object.computed && n.object.object.type === "Identifier" &&
          n.object.object.name === "_ctx" && n.object.property.name === "$slots");
      if (slotsObject) {
        if (!comp.slotNames.includes(prop)) fail(comp, `\`$slots.${prop}\` names a slot this template does not render`, n);
        return { code: `fv_slots.${snake(prop)}.is_some()`, ty: BOOL };
      }
      if (n.object.type === "Identifier") {
        switch (n.object.name) {
          case "$props":
            return fieldVal(comp, "props", { k: "struct", name: "Props" }, prop, n);
          case "$setup":
          case "_ctx": {
            const global = n.object.name === "_ctx" ? claim((p) => p.global?.(s, prop, n)) : undefined;
            if (global) return global;
            if (n.object.name === "_ctx" && prop === "$attrs") {
              return fail(comp, "`$attrs` is bound whole, with `v-bind=\"$attrs\"`; a value read from it has no type: declare it as a prop", n);
            }
            const v = s.setup.get(prop);
            if (v) return v;
            if (s.clientOnly.has(prop)) {
              return fail(comp, `\`${prop}\` is set up in a way the server cannot evaluate: ${s.clientOnly.get(prop)}`, n);
            }
            if (n.object.name === "_ctx" && comp.props.fields.some((f) => f.js === prop)) {
              return fieldVal(comp, "props", { k: "struct", name: "Props" }, prop, n);
            }
            return fail(comp, `\`${prop}\` is not available when rendering on the server`, n);
          }
        }
      }
      const base = expr(s, n.object);
      return claim((p) => p.member?.(s, base, prop, n, false)) ?? fieldVal(comp, base.code, base.ty, prop, n);
    }
    case "CallExpression":
      return call(s, n);
    case "LogicalExpression": {
      if (n.operator === "&&" || n.operator === "||") {
        const p = presence(s, n.left);
        if (p && p.negated === (n.operator === "||") && (p.negated || !p.truthy)) {
          let right: Val | undefined;
          const code = narrowing(s, p, (inner) => (right = expr(inner, n.right)).code, () => String(n.operator === "||"));
          if (right?.ty.k === "bool") return { code, ty: BOOL };
          return fail(comp, `\`${n.operator}\` is supported between booleans only`, n);
        }
      }
      const a = expr(s, n.left);
      const b = expr(s, n.right);
      if (n.operator === "??") {
        const own = claim((p) => p.values?.nullish?.(s, a, b, n));
        if (own) return own;
        if (a.ty.k !== "opt") return a;
        if (b.ty.k === "undef") return a;
        if (b.iter !== undefined) fail(comp, "`??` falling back to a computed list", n);
        if (a.held !== undefined && b.ty.k === "str") return { code: `&*${atom(a.held)}.unwrap_or(${asCow(b)})`, ty: STR, ...loneOf(a, b) };
        if (a.ty.of.k === "str" && b.ty.k === "str" && isTemporary(b)) {
          return { code: `&*${atom(a.code)}.map(std::borrow::Cow::<str>::Borrowed).unwrap_or(${asCow(b)})`, ty: STR, ...loneOf(a, b) };
        }
        if (sameTy(a.ty.of, b.ty)) return { code: `${atom(a.code)}.unwrap_or(${bare(b.code)})`, ty: b.ty, ...loneOf(a, b) };
        if (sameTy(a.ty, b.ty)) return { code: `${atom(a.code)}.or(${bare(b.code)})`, ty: a.ty, ...loneOf(a, b) };
        if (a.ty.of.k === "float" && b.ty.k === "int") return { code: `${atom(a.code)}.unwrap_or(${bare(asF64(b))})`, ty: FLOAT };
        if (a.ty.of.k === "int" && b.ty.k === "float") return { code: `${atom(a.code)}.map(|v| v as f64).unwrap_or(${bare(b.code)})`, ty: FLOAT };
        return fail(comp, "`??` between different types", n);
      }
      if (n.operator === "||") {
        if (a.ty.k === "bool" && b.ty.k === "bool") return boolOf(logical(a.code, "||", b.code));
        if (b.ty.k === "undef") {
          const inner: Ty = a.ty.k === "opt" ? a.ty.of : a.ty;
          const src = a.ty.k === "opt" ? atom(a.code) : `Some(${bare(a.code)})`;
          return { code: `${src}.filter(|v| ${truthy({ code: "*v", ty: inner })})`, ty: opt(inner) };
        }
        if (a.ty.k === "str" && b.ty.k === "str" && known(a) !== undefined) return known(a) ? a : b;
        if (a.ty.k === "str" && b.ty.k === "str" && (isTemporary(a) || isTemporary(b))) {
          return { code: `&*{ let a = ${asCow(a)}; if !a.is_empty() { a } else { ${asCow(b)} } }`, ty: STR, ...loneOf(a, b) };
        }
        if (sameTy(a.ty, b.ty) && (a.ty.k === "str" || isNumber(a.ty))) {
          const k = known(a);
          if (k !== undefined) return k ? a : b;
          const otherwise = a.ty.k === "str" ? strArg(b.code) : bare(b.code);
          return { code: `{ let a = ${bare(a.code)}; if ${truthy({ code: "a", ty: a.ty })} { a } else { ${otherwise} } }`, ty: a.ty, ...loneOf(a, b) };
        }
        return fail(comp, "`||` between these types", n);
      }
      if (n.operator === "&&" && a.ty.k === "bool" && b.ty.k === "bool") return boolOf(logical(a.code, "&&", b.code));
      return fail(comp, `\`${n.operator}\` is supported between booleans only`, n);
    }
    case "UnaryExpression":
      if (n.operator === "!") {
        return negatedOrder(s, n.argument) ?? boolOf(not(truthy(expr(s, n.argument))));
      }
      if (n.operator === "-") {
        const a = expr(s, n.argument);
        if (isNumber(a.ty) && a.num !== undefined) return numberVal(-a.num, a.ty.k === "int");
        if (a.ty.k === "int") return intFromF64(negate(asF64(a)));
        if (a.ty.k === "float") return { code: negate(a.code), ty: FLOAT };
      }
      return fail(comp, `unary \`${n.operator}\``, n);
    case "BinaryExpression": {
      if (n.operator !== "===" && n.operator !== "!==") fail(comp, `\`${n.operator}\``, n);
      const whole = claim((p) => p.equality?.(s, n));
      if (whole) return whole;
      const a = expr(s, n.left);
      const b = expr(s, n.right);
      let eq: string;
      const scalar = (t: Ty) => t.k === "str" || t.k === "int" || t.k === "bool";
      const strish = (t: Ty) => t.k === "str" || (t.k === "opt" && t.of.k === "str");
      if (strish(a.ty) && strish(b.ty)) meet(comp, a, b, `\`${n.operator}\``, n, "equal");
      const own = claim((p) => p.values?.equals?.(a, b));
      if (own !== undefined) eq = own;
      else if (b.ty.k === "undef" && a.ty.k === "opt") eq = `${atom(a.code)}.is_none()`;
      else if (a.ty.k === "undef" && b.ty.k === "opt") eq = `${atom(b.code)}.is_none()`;
      else if (a.ty.k === "undef" || b.ty.k === "undef") {
        const same = a.ty.k === b.ty.k;
        const konst = n.operator === "===" ? same : !same;
        return { code: String(konst), ty: BOOL, konst };
      }
      else if (isNumber(a.ty) && isNumber(b.ty)) eq = compare(a, "==", b).code;
      else if (a.ty.k === "str" && b.ty.k === "str" && known(a) !== undefined && known(b) !== undefined) eq = String(unquote(a.code) === unquote(b.code));
      else if (a.ty.k === "str" && b.ty.k === "str" && (a.code === '""' || b.code === '""')) {
        eq = `${receiver(a.code === '""' ? b.code : a.code)}.is_empty()`;
      } else if (a.ty.k === "bool" && b.ty.k === "bool" && (a.konst !== undefined || b.konst !== undefined)) {
        const [k, other] = a.konst !== undefined ? [a.konst, b.code] : [b.konst!, a.code];
        eq = k ? other : not(other);
      } else if (sameTy(a.ty, b.ty) && (scalar(a.ty) || (a.ty.k === "opt" && scalar(a.ty.of)))) {
        eq = binary(a.code, "==", b.code);
      } else if (a.ty.k === "opt" && sameTy(a.ty.of, b.ty) && scalar(b.ty)) eq = binary(a.code, "==", `Some(${bare(b.code)})`);
      else if (b.ty.k === "opt" && sameTy(b.ty.of, a.ty) && scalar(a.ty)) eq = binary(`Some(${bare(a.code)})`, "==", b.code);
      else return fail(comp, "`===` between these types", n);
      return boolOf(n.operator === "===" ? eq : not(eq));
    }
    case "ConditionalExpression": {
      const t = expr(s, n.test);
      const k = known(t);
      if (k !== undefined) return expr(s, k ? n.consequent : n.alternate);
      const p = presence(s, n.test);
      const name = p ? `n${++ctx.narrowCount}` : "";
      const a = expr(p && !p.negated ? narrowTo(s, p, name) : s, n.consequent);
      const b = expr(p && p.negated ? narrowTo(s, p, name) : s, n.alternate);
      if (sameTy(a.ty, b.ty) && a.code === b.code && (!name || !occurrences(a.code, name))) return a;
      const second = (code: string) => (a.ty.k === "str" ? strArg(code) : bare(code));
      const choose = (yes: string, no: string): string => {
        if (!p) return choice(truthy(t), bare(yes), second(no));
        const [present, absent] = p.negated ? [bare(no), second(yes)] : [bare(yes), second(no)];
        if (present === `Some(${name})` && absent === "None") return p.option;
        if (present === name) return `${atom(p.option)}.unwrap_or(${absent})`;
        if (occurrences(present, name)) return `if ${p.pattern(name)} { ${present} } else { ${absent} }`;
        return choice(p.present, present, absent);
      };
      const lone = loneOf(a, b);
      if (sameTy(a.ty, b.ty) && a.ty.k === "str" && (isTemporary(a) || isTemporary(b))) {
        return { code: `&*(${choose(asCow(a), asCow(b))})`, ty: STR, ...lone };
      }
      if (sameTy(a.ty, b.ty) && a.ty.k === "list" && (a.iter !== undefined || b.iter !== undefined)) {
        const both = `(${choose(collected(a), collected(b))})`;
        return { code: both, ty: a.ty, iter: `${both}.into_iter()`, ...lone };
      }
      const optStr = (v: Val) => v.ty.k === "undef" || (v.ty.k === "opt" && v.ty.of.k === "str") || v.ty.k === "str";
      if (sameTy(a.ty, b.ty) && a.ty.k !== "opt") return { code: choose(a.code, b.code), ty: a.ty, ...lone };
      if (isNumber(a.ty) && isNumber(b.ty)) return { code: choose(asF64(a), asF64(b)), ty: FLOAT };
      if (sameTy(a.ty, b.ty) || a.ty.k === "undef" || b.ty.k === "undef" || (a.ty.k === "opt" && sameTy(a.ty.of, b.ty)) || (b.ty.k === "opt" && sameTy(b.ty.of, a.ty))) {
        const ty = opt(a.ty.k === "undef" || b.ty.k === "opt" ? b.ty : a.ty);
        if (optStr(a) && optStr(b) && (isTemporary(a) || isTemporary(b) || a.held !== undefined || b.held !== undefined)) {
          const held = (v: Val): string =>
            v.held ?? (v.ty.k === "undef" ? "None" : v.ty.k === "opt" ? `${atom(v.code)}.map(std::borrow::Cow::<str>::Borrowed)` : `Some(${asCow(v)})`);
          const both = atom(choose(held(a), held(b)));
          return { code: `${both}.as_deref()`, ty, held: both, ...lone };
        }
        if (sameTy(a.ty, b.ty)) return { code: choose(a.code, b.code), ty: a.ty, ...lone };
        return { code: choose(coerce(comp, a, ty, n), coerce(comp, b, ty, n)), ty, ...lone };
      }
      return fail(comp, "the two branches of `?:` differ in type", n);
    }
    default:
      return fail(comp, `\`${n.type}\` is not supported in an island template`, n);
  }
}
