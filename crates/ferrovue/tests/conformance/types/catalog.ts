export interface Choice {
  id: number;
  label: string;
  hint?: string;
}

export const LABELS = { title: "Catalogue <b>", empty: "Nothing & \"none\"", counts: { max: 3 } } as const;

export const SIZES = ["sm", "md", "lg"] as const;

export const LIMITS = [1, 2.5, -3];

export const CHOICES: Choice[] = [
  { id: 1, label: "One" },
  { id: 2, label: "Two \"2\"", hint: "<even>" },
];

export const SORTS = [
  { key: "name", label: "By name", desc: false, badge: null },
  { key: "price", label: "By price & more", desc: true, badge: "<new>" },
] as const;

export enum Tone {
  Calm = "calm",
  Loud = "loud",
}

export enum Rank {
  Low,
  Mid = 5,
  High,
}
