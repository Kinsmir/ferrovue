<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";
import { reversed, stars, thousands } from "./loops";

interface Row {
  name: string;
  score: number;
}

const UNITS = { kb: 1024, mb: 1048576 } as const;

const props = defineProps<{ words: string[]; n: number; s: string; rows: Row[]; nums: number[]; ratio: Float; target: string }>();

function initials(words: string[]): string {
  let out = "";
  for (const w of words) {
    for (const ch of w) {
      out += ch;
      break;
    }
  }
  return out;
}

const total = computed(() => {
  let sum = 0;
  for (const r of props.rows) sum += r.score;
  return sum;
});

const mean = computed(() => {
  let sum = 0;
  let count = 0;
  for (const r of props.rows) {
    sum += r.score * props.ratio;
    count++;
  }
  return count === 0 ? "none" : (sum / count).toFixed(2);
});

const best = computed(() => {
  let top = -Infinity;
  let low = Infinity;
  let who = "";
  for (const r of props.rows) {
    if (r.score > top) {
      top = r.score;
      who = r.name;
    }
    if (r.score < low) low = r.score;
  }
  return `${who}:${top}/${low}`;
});

function spelled(s: string): string {
  let out = "";
  let units = 0;
  let points = 0;
  for (const ch of s) {
    points++;
    units += ch.length;
    if (ch === " ") {
      out += "_";
      continue;
    }
    if (ch === "!") break;
    out += `[${ch}]`;
  }
  return `${out}|${points}/${units}`;
}

function lastOf(s: string): string {
  let sizes = "";
  let first = 0;
  let last = "";
  let count = 0;
  for (const ch of s.slice(1)) {
    if (count === 0) first = ch.length;
    sizes += ch.length;
    last = ch;
    count += 1;
  }
  return `${sizes}|${first}|${last}|${count}`;
}

function indexOf(words: string[], target: string): number {
  for (const [i, w] of words.entries()) {
    if (w === target) return i;
  }
  return -1;
}

function firstLong(words: string[]): string {
  let found: string | undefined = undefined;
  for (const w of words) {
    if (w.length > 3) {
      found = w;
      break;
    }
  }
  return found ?? "-";
}

const product = computed(() => {
  let p = 1;
  let sign = 1;
  for (const x of props.nums) {
    p *= x;
    sign *= -1;
  }
  const zero = 0 * sign;
  return `${p}|${1 / zero}`;
});

const flags = computed(() => {
  let all = true;
  let any = false;
  for (const x of props.nums) {
    if (x <= 0) all = false;
    else any = true;
  }
  return `${all}/${any}`;
});

const pairs = computed(() => {
  let n = 0;
  for (const w of props.words) {
    for (const r of props.rows) {
      if (r.name === w) n++;
    }
  }
  return n;
});

function findPair(words: string[], rows: Row[]): string {
  for (const w of words) {
    for (const r of rows) {
      if (r.name === w && r.score > 0) return `${w}=${r.score}`;
    }
  }
  return "no pair";
}

function units(): string {
  let out = "";
  for (const k of Object.keys(UNITS)) out += `${k};`;
  return out;
}

function countdown(n: number): string {
  let out = "";
  let left = Math.min(n, 6);
  for (let i = left; i > 0; i -= 2) {
    out += `${i} `;
    left -= 2;
  }
  return `${out}(${left})`;
}

function label(n: number): string {
  let label = "small";
  if (n > 100) label = "large";
  else if (n > 10) label = "medium";
  label += n % 2 === 0 ? " even" : " odd";
  return label;
}

const backwards = computed(() => props.rows.map((r) => {
  let out = "";
  for (const ch of r.name) out = ch + out;
  return out;
}).join(","));
</script>

<template>
  <section>
    <p>{{ initials(words) }}|{{ thousands(n) }}|{{ thousands(n * 1000003) }}|{{ stars(n) }}</p>
    <p>{{ total }}|{{ mean }}|{{ best }}|{{ pairs }}</p>
    <p :title="spelled(s)">{{ spelled(target) }}|{{ lastOf(s) }}|{{ reversed(s) }}</p>
    <p>{{ indexOf(words, target) }}|{{ firstLong(words) }}|{{ findPair(words, rows) }}</p>
    <p>{{ product }}|{{ flags }}|{{ units() }}|{{ countdown(n) }}|{{ label(n) }}</p>
    <p>{{ backwards }}</p>
  </section>
</template>
