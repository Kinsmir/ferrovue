export interface Owner {
  name: string;
  email?: string;
}

export interface Choice {
  id: number;
  label: string;
}

export const CHOICES: Choice[] = [
  { id: 1, label: "One" },
  { id: 2, label: "Two" },
];
