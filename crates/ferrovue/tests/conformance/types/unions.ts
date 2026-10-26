export type Align = "left" | "center" | "right";

export type Shade = "warm" | "x-cool" | "<b>&'q'\"";

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

export type Hue = "red" | "green" | "<b>&\"hue'";

export interface HueSet {
  hues: Hue[];
  note: string;
}
