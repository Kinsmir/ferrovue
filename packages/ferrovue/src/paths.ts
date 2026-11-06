import * as nodePath from "node:path";

/** `path.relative`, written with `/` on every platform. A path the compiler writes into generated
 * code, a diagnostic or a key, or compares with a configured folder such as `out`, reads the same
 * on Windows as elsewhere. `path` is Node's own, and `path.win32` in a test. */
export function relativePath(from: string, to: string, path: Pick<typeof nodePath, "relative" | "sep"> = nodePath): string {
  return slashed(path.relative(from, to), path);
}

/** A path written with `/` on every platform, as Vite writes the ids and imports it reads. */
export function slashed(file: string, path: Pick<typeof nodePath, "sep"> = nodePath): string {
  return file.split(path.sep).join("/");
}
