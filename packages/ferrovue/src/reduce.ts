import { type N, type Scope, type Ty, type Val, FLOAT } from "./model.ts";
import { fail } from "./locate.ts";
import { isAscii, strTy } from "./literal-types.ts";
import { bare, enclosed } from "./parens.ts";
import { arrow, backwards, items, itemsTy } from "./lists.ts";
import { describeTy, expr } from "./expr.ts";
import { unbound } from "./narrowing.ts";
import { ctx } from "./context.ts";
import { fresh, jsHint } from "./names.ts";
import { asF64, isNumber } from "./numbers.ts";

export const RISKS_NEGATIVE_ZERO = /-[\w(]|\s[*%]\s/;

export function ownedString(v: Val, acc: string): string {
  if (v.code === `&*${acc}`) return acc;
  if (v.code === '""') return "String::new()";
  const built = /^&\*(format!\(.*\))$/s.exec(v.code)?.[1];
  if (built !== undefined && enclosed(built.slice("format!".length))) return built;
  return `String::from(${bare(v.code)})`;
}

export function reduced(s: Scope, target: Val, method: string, args: N[], n: N): Val {
  const comp = s.comp;
  if (args.length < 2) {
    fail(comp, "FV0828", `\`.${method}()\` takes an initial value after its function: without one, JavaScript throws a \`TypeError\` on an empty list`, n);
  }
  if (args.length > 2) fail(comp, "FV0829", `\`.${method}()\` takes a function and an initial value`, n);
  const of = itemsTy(s, target, n);
  const fn = args[0];
  if (fn?.type !== "ArrowFunctionExpression" || fn.async || fn.params.length < 2 || fn.params.length > 3 || fn.params[0].type !== "Identifier") {
    fail(comp, "FV0829", `\`.${method}()\` takes an arrow function of the accumulator, the item and its index: \`(acc, x) => …\` or \`(acc, x, i) => …\``, fn);
  }
  const accName: string = fn.params[0].name;
  const init = expr(s, args[1]);
  if (!["str", "int", "float", "bool"].includes(init.ty.k)) {
    fail(comp, "FV0829", `\`.${method}()\` accumulates a string, a number or a boolean that is present, and its initial value is ${describeTy(init.ty)}`, args[1]);
  }
  let accTy: Ty = init.ty.k === "int" && init.f64 !== undefined && RISKS_NEGATIVE_ZERO.test(init.f64) ? FLOAT : ({ k: init.ty.k } as Ty);
  let lone = !!init.lone;
  let ascii = isAscii(init.ty);
  const item = { ...fn, params: fn.params.slice(1) };
  const narrowed = unbound(s.narrowed, [accName]);
  for (;;) {
    const mark = ctx.narrowCount;
    const acc = fresh("acc", jsHint(accName));
    const accVal: Val = accTy.k === "str" ? { code: `&*${acc}`, ty: strTy(ascii), ...(lone ? { lone } : {}) } : { code: acc, ty: accTy };
    const outer: Scope = { ...s, locals: new Map(s.locals).set(accName, accVal), narrowed };
    const seen = { wider: false, loner: false, wide: false };
    const { closure, enumerate } = arrow(outer, item, target, of, false, method, (inner) => {
      const out = expr(inner, fn.body);
      const changes = `the function gives ${describeTy(out.ty)} where the accumulator, from its initial value, is ${describeTy(accTy)}`;
      switch (accTy.k) {
        case "str":
          if (out.ty.k !== "str") fail(comp, "FV0829", `\`.${method}()\` keeps one type of accumulator, and ${changes}`, fn.body);
          if (out.lone && !lone) seen.loner = true;
          if (ascii && !isAscii(out.ty)) seen.wide = true;
          return ownedString(out, acc);
        case "int":
          if (out.ty.k === "float" || (out.ty.k === "int" && out.f64 !== undefined && RISKS_NEGATIVE_ZERO.test(out.f64))) seen.wider = true;
          else if (out.ty.k !== "int") fail(comp, "FV0829", `\`.${method}()\` keeps one type of accumulator, and ${changes}`, fn.body);
          return bare(out.code);
        case "float":
          if (!isNumber(out.ty)) fail(comp, "FV0829", `\`.${method}()\` keeps one type of accumulator, and ${changes}`, fn.body);
          return bare(asF64(out));
        default:
          if (out.ty.k !== "bool") fail(comp, "FV0829", `\`.${method}()\` keeps one type of accumulator, and ${changes}`, fn.body);
          return bare(out.code);
      }
    });
    if (seen.wider) {
      accTy = FLOAT;
      continue;
    }
    if (seen.loner || seen.wide) {
      if (!seen.loner) ctx.narrowCount = mark;
      lone ||= seen.loner;
      ascii &&= !seen.wide;
      continue;
    }
    const start = accTy.k === "str" ? ownedString(init, "") : accTy.k === "float" ? bare(asF64(init)) : bare(init.code);
    const reads = new RegExp(`\\b${acc}\\b`).test(closure);
    const step = closure.replace(/^\|/, `|${reads ? acc : "_"}, `);
    const from = method === "reduce" ? `${items(target)}${enumerate ? ".enumerate()" : ""}` : `${backwards(target)}${enumerate ? ".enumerate()" : ""}.rev()`;
    const folded = `fv::strings::js_reduce(${from}, ${start}, ${step})`;
    if (accTy.k === "str") return { code: `&*${folded}`, ty: strTy(ascii), ...(lone ? { lone } : {}) };
    return { code: folded, ty: accTy };
  }
}
