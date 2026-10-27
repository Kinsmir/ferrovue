import type { Mood } from "./tables.ts";

export type Span = [from: string, to: string];

export interface Booking {
  span: Span;
  seats: readonly [number, number];
  tagged: [Mood, string | null];
}
