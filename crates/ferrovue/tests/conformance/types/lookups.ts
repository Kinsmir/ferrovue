export enum Tone {
  Info = "info",
  Warn = "warn",
  Danger = "danger",
}

export type Size = "sm" | "md" | "lg";

export type Kind = "note" | "tip" | "alert";

export const THEME: Record<Tone, { fg: string; bg: string; dark: boolean; weight: number }> = {
  [Tone.Info]: { fg: "navy", bg: "#eef", dark: false, weight: 400 },
  [Tone.Warn]: { fg: "<b>\"&amp;'", bg: "#ffd", dark: false, weight: 600 },
  [Tone.Danger]: { fg: "white", bg: "#a00", dark: true, weight: 700.5 },
};

export const LABELS = { sm: "Small", md: "Medium & <more>", lg: "Large \"L\"" } as const;

export const ICONS: Partial<Record<Kind, { label: string; glyph: string }>> = {
  note: { label: "Note", glyph: "ℹ" },
  tip: { label: "Tip <!>", glyph: "★" },
};
