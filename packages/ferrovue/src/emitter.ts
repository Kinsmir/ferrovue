/* The Rust statements a render is written as. */

import { rustChar, rustStr } from "./model.ts";
import { occurrences } from "./parens.ts";

/** Statements, with adjacent literal pushes merged into one `push_str`. */
export class Emitter {
  lines: string[] = [];
  /** Bytes of markup written once per render, part of what `render` reserves up front: the literal
   * markup, and what the numbers written at run time are expected to take. */
  literalBytes = 0;
  /** Rust expressions for the rest of the reservation: a loop's markup once per item. */
  perItem: string[] = [];
  private pending = "";
  private depth = 1;

  lit(s: string): void {
    this.pending += s;
    this.literalBytes += Buffer.byteLength(s);
  }

  /** `bytes` more expected of a value written at run time. */
  expect(bytes: number): void {
    this.literalBytes += bytes;
  }

  stmt(code: string): void {
    this.flush();
    this.lines.push("    ".repeat(this.depth) + code);
  }

  open(code: string): void {
    this.stmt(code ? code + " {" : "{");
    this.depth++;
  }

  close(tail = ""): void {
    this.flush();
    this.depth--;
    this.lines.push("    ".repeat(this.depth) + "}" + tail);
    // `} else {` closes one block and opens the next.
    if (tail.endsWith("{")) this.depth++;
  }

  /** Whether the lines from \`from\` on read \`name\`. Literals are skipped, so markup that happens to
   * spell the name does not count, and so are fields of that name. */
  reads(name: string, from: number): boolean {
    this.flush();
    return occurrences(this.lines.slice(from).join("\n"), name) > 0;
  }

  /** Replace \`from\` with \`to\` in line \`index\`: an unused binding renamed to \`_\`. */
  replace(index: number, from: string, to: string): void {
    // A function, so a `$&` or `$'` in the generated text is not read as a replacement pattern.
    this.lines[index] = this.lines[index]!.replace(from, () => to);
  }

  flush(): void {
    if (!this.pending) return;
    const text = this.pending;
    this.pending = "";
    // One character is pushed as a `char`.
    const push = /^.$/su.test(text) ? `out.push(${rustChar(text)});` : `out.push_str(${rustStr(text)});`;
    this.lines.push("    ".repeat(this.depth) + push);
  }
}
