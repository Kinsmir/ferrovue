import { describe, expect, it } from "vitest";
import { yieldsCow } from "../src/strings.ts";

const COW = "std::borrow::Cow::<str>::";

describe("yieldsCow", () => {
  it.each([
    ["a `Cow` fallback", `x.unwrap_or(${COW}Borrowed("x"))`, true],
    ["a `&str` fallback", `x.unwrap_or("x")`, false],
    ["a fallback in parentheses", `x.unwrap_or((${COW}Borrowed("x")))`, false],
    ["a block that ends in a `Cow` after a loop", `x.unwrap_or({ for _ in a {} ${COW}Owned(s) })`, true],
    ["a block that ends in a `Cow` after a `let`", `x.unwrap_or({ let a = f(1); ${COW}Owned(a) })`, true],
    ["a block that is only a `Cow`", `x.unwrap_or({ ${COW}Owned(a) })`, true],
    ["a block whose `Cow` holds a `;` in parentheses", `x.unwrap_or({ let a = 1; ${COW}Owned(g(x; y)) })`, true],
    ["a block whose `Cow` holds a `;` in brackets", `x.unwrap_or({ let a = 1; ${COW}Owned([a; 2].concat()) })`, true],
    ["a block with a parenthesis in a string", `x.unwrap_or({ let s = "("; ${COW}Owned(s) })`, true],
    ["a block with a brace in a character", `x.unwrap_or({ let c = '{'; ${COW}Owned(c) })`, true],
    ["a block that ends in an `if`", `x.unwrap_or({ let a = 1; if c { ${COW}Owned(a) } else { ${COW}Borrowed(b) } })`, false],
    ["a block that does not end in a `Cow`", `x.unwrap_or({ let a = 1; a })`, false],
    ["a block with an unclosed parenthesis", `x.unwrap_or({ let a = (1; ${COW}Owned(a) })`, false],
  ])("reads %s", (_, code, cow) => {
    expect(yieldsCow(code)).toBe(cow);
  });
});
