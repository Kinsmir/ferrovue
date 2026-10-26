import type { App } from "vue";

/** Push what Vue warns about in `app` onto `problems`. */
export function warnInto(app: App, problems: string[]): void {
  app.config.warnHandler = (message) => void problems.push(`warning: ${message}`);
}

/** Run `body` with what the console warns and logs as an error pushed onto `problems`, and the
 * console restored afterwards. */
export async function consoleInto<T>(problems: string[], body: () => Promise<T>): Promise<T> {
  const { warn, error } = console;
  console.warn = (...args: unknown[]) => void problems.push(`console.warn: ${args.map(String).join(" ")}`);
  console.error = (...args: unknown[]) => void problems.push(`console.error: ${args.map(String).join(" ")}`);
  try {
    return await body();
  } finally {
    console.warn = warn;
    console.error = error;
  }
}

/** Unmount `app` and throw `heading` with the problems under it, when there are any. */
export function throwProblems(app: App, problems: string[], heading: string): void {
  if (!problems.length) return;
  app.unmount();
  throw new Error(`${heading}:\n${problems.join("\n")}`);
}
