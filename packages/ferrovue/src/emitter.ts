import { rustChar, rustStr } from "./model.ts";
import { occurrences } from "./parens.ts";

export class Emitter {
  lines: string[] = [];
  literalBytes = 0;
  perItem: string[] = [];
  private pending = "";
  private depth = 1;

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
  }

  close(tail = ""): void {
    this.flush();
    this.depth--;
    this.lines.push("    ".repeat(this.depth) + "}" + tail);
    if (tail.endsWith("{")) this.depth++;
  }

  reads(name: string, from: number): boolean {
    this.flush();
    return occurrences(this.lines.slice(from).join("\n"), name) > 0;
  }

  replace(index: number, from: string, to: string): void {
    this.lines[index] = this.lines[index]!.replace(from, () => to);
  }

  flush(): void {
    if (!this.pending) return;
    const text = this.pending;
    this.pending = "";
    const push = /^.$/su.test(text) ? `out.push(${rustChar(text)});` : `out.push_str(${rustStr(text)});`;
    this.lines.push("    ".repeat(this.depth) + push);
  }
}
