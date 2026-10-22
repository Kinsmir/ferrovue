export enum Tone {
  Info = "info",
  Warn = "warn",
  Calm = "calm",
}

export const THEME: Record<Tone, { fg: string }> = {
  [Tone.Info]: { fg: "navy" },
  [Tone.Warn]: { fg: "red" },
  [Tone.Calm]: { fg: "navy" },
};
