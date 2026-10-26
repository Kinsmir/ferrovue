import type { Mood } from "./tables.ts";

export interface ImportedCardProps {
  title: string;
  count?: number;
  mood: Mood;
  tags: string[];
  note?: string;
}

export type ImportedBase = { label: string; on?: boolean };
