import { rustChar, rustStr } from "./model.ts";
import { occurrences } from "./parens.ts";

export class Emitter {
  lines: string[] = [];
  literalBytes = 0;
  perItem: string[] = [];
  private pending = "";
  private depth = 1;
  private closures: boolean[] = [];

  /** Whether the statements written now are in a closure, slot content or a fallback, where a
   * refusal is held for the render to return. */
  get inClosure(): boolean {
    return this.closures.includes(true);
  }

  lit(s: string): void {
    this.pending += s;
    this.literalBytes += Buffer.byteLength(s);
  }

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
    this.closures.push(/\|out: &mut String\b/.test(code));
  }

  close(tail = ""): void {
    this.flush();
    this.depth--;
    this.lines.push("    ".repeat(this.depth) + "}" + tail);
    const closure = this.closures.pop() ?? false;
    if (tail.endsWith("{")) {
      this.depth++;
      this.closures.push(closure);
    }
  }

  reads(name: string, from: number): boolean {
    this.flush();
    return occurrences(this.lines.slice(from).join("\n"), name) > 0;
  }

  replace(index: number, from: string, to: string): void {
    this.lines[index] = this.lines[index]!.replace(from, () => to);
  }

  mark(): () => void {
    const { pending, depth, literalBytes } = this;
    const lines = this.lines.length;
    const perItem = this.perItem.length;
    const closures = [...this.closures];
    return () => {
      this.lines.length = lines;
      this.perItem.length = perItem;
      this.pending = pending;
      this.depth = depth;
      this.literalBytes = literalBytes;
      this.closures = closures;
    };
  }

  flush(): void {
    if (!this.pending) return;
    const text = this.pending;
    this.pending = "";
    const push = /^.$/su.test(text) ? `out.push(${rustChar(text)});` : `out.push_str(${rustStr(text)});`;
    this.lines.push("    ".repeat(this.depth) + push);
  }
}
