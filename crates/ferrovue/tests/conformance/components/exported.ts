const GREETING = "Hello";
const SIZES = ["sm", "md", "lg"] as const;
const LABEL = "size";

enum Tone {
  Calm = "calm",
  Loud = "loud",
}

function shout(s: string): string {
  return `${s.toUpperCase()}!`;
}

export { GREETING, SIZES as ORDERS, Tone, shout as loud };
export default LABEL;
