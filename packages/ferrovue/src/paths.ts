import * as nodePath from "node:path";

/** `path.relative`, written with `/` on every platform. A path the compiler writes into generated
 * code, a diagnostic or a key, or compares with a configured folder such as `out`, reads the same
 * on Windows as elsewhere. `path` is Node's own, and `path.win32` in a test. */
export function relativePath(from: string, to: string, path: Pick<typeof nodePath, "relative" | "sep"> = nodePath): string {
  return path.relative(from, to).split(path.sep).join("/");
}
