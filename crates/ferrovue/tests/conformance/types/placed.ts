import type { Mood } from "./tables.ts";

export interface Placed {
  title: string;
  mood: Mood;
  author: { name: string; links: { href: string; label?: string }[] };
  counts: { [K in "seen" | "liked"]: number };
}
