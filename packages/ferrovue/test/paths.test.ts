import { posix, win32 } from "node:path";
import { expect, it } from "vitest";
import { relativePath } from "../src/paths.ts";

it("writes a relative path with / on Windows, as on every other platform", () => {
  expect(relativePath("C:\\app", "C:\\app\\components\\Card.vue", win32)).toBe("components/Card.vue");
  expect(relativePath("C:\\app", "C:\\app\\src\\generated\\card.rs", win32)).toBe("src/generated/card.rs");
  expect(relativePath("C:\\app\\client", "C:\\app\\types\\book.ts", win32)).toBe("../types/book.ts");
  expect(relativePath("/app", "/app/components/Card.vue", posix)).toBe("components/Card.vue");
  expect(relativePath("/app", "/app")).toBe("");
});
