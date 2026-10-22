export type Align = "left" | "center" | "right";

export enum Level {
  Low = "low",
  High = "high",
}

export interface Step {
  label: string;
  state: "todo" | "done" | "skipped";
  align?: Align;
}

export const STATE_LABELS = { todo: "To do", done: "Done & <dusted>", skipped: "Skipped" } as const;

const SIDE = "ri";

export const END = `${SIDE}ght` as const;
