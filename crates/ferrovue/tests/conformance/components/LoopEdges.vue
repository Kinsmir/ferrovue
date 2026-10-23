<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";

const props = defineProps<{ tags: string[]; counts: Record<string, number>; n: number; f: Float; text: string; mode: "sum" | "max" | "skip" }>();

const kept = computed(() => props.tags.filter((t) => t.trim() !== "").map((t) => t.trim()));

function mixed(tags: string[], mode: "sum" | "max" | "skip"): string {
  let out = "";
  let acc = 0;
  for (const t of tags) {
    switch (mode) {
      case "sum":
        acc += t.length;
        break;
      case "max":
        if (t.length > acc) acc = t.length;
        break;
      default:
        continue;
    }
    out += `${t}:${acc};`;
  }
  return `${out}=${acc}`;
}

function tally(counts: Record<string, number>): string {
  let out = "";
  let total = 0;
  for (const [key, value] of Object.entries(counts)) {
    total += value;
    out += `${key}=${value},`;
  }
  return `${out}${total}`;
}

function halves(n: number, f: Float): string {
  let x = n;
  let steps = 0;
  for (const _ of [1, 2, 3, 4]) {
    x = x / 2;
    steps++;
  }
  let y: number | undefined = undefined;
  for (const k of [f, n * 1.5, 0.5]) {
    if (y === undefined || k < y) y = k;
  }
  return `${x}|${steps}|${y === undefined ? "none" : y}|${-0 * n}|${String(f * 0)}`;
}

function search(tags: string[], text: string): string {
  for (const [i, t] of tags.entries()) {
    for (const ch of text) {
      if (ch === "#") return `hash before ${i}`;
      if (t.includes(ch)) return `${i}:${ch}`;
    }
  }
  return "none";
}

function grid(n: number): string {
  let out = "";
  const size = n > 4 ? 4 : n;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col <= row; col++) {
      if (col === 2) continue;
      out += col === row ? `${col}/` : `${col}`;
    }
  }
  return out;
}

function upto(n: number): number {
  let i = 0;
  for (let k = 10; k > 0; k -= 3) {
    if (k <= n) return k;
    i += k;
  }
  return i;
}

function code(text: string): string {
  let ascii = true;
  let wide = 0;
  for (const ch of text) {
    if (ch.length > 1) wide++;
    else if (ch > "~") ascii = false;
  }
  return `${ascii}/${wide}`;
}

function longest(tags: string[]): string {
  let found: string | undefined = undefined;
  for (const t of tags) {
    if (found !== undefined && found.length >= t.length) continue;
    found = found === undefined ? t : `${t}>${found}`;
  }
  return found === undefined ? "-" : found;
}

function shorter(tags: string[]): number {
  let count = 1;
  for (const t of tags) count += tags.filter((u) => u.length < count + t.length).length;
  return count;
}

function seek(tags: string[], n: number): number {
  let seen = 0;
  for (const t of tags) {
    for (let i = 0; i <= n; i += 2) {
      seen += i;
      if (t.length === i) return seen * 10 + i;
    }
  }
  return -seen;
}

function widened(n: number, tags: string[]): string {
  let out = String(n);
  for (const t of tags) out = out + t;
  let parts = 0;
  for (const _ of out.split("")) parts++;
  return `${out}|${parts}`;
}

function people(counts: Record<string, number>): string {
  let keys = "";
  for (const [k] of Object.entries(counts)) keys += k;
  let odd = 0;
  for (const { length } of Object.keys(counts)) if (length % 2 === 1) odd++;
  return `${keys}|${odd}`;
}

const lengths = computed(() =>
  props.tags.map((t) => {
    let count = 0;
    for (const ch of t) if (ch !== " ") count++;
    return count;
  }),
);
</script>

<template>
  <ul>
    <li v-for="t in kept" :key="t">{{ t }}</li>
  </ul>
  <p>{{ mixed(kept, mode) }}|{{ tally(counts) }}</p>
  <p>{{ halves(n, f) }}|{{ search(tags, text) }}</p>
  <p :data-grid="grid(n)">{{ upto(n) }}|{{ code(text) }}|{{ lengths.join("-") }}</p>
  <p>{{ longest(tags) }}|{{ shorter(tags) }}|{{ seek(tags, n) }}|{{ widened(n, tags) }}|{{ people(counts) }}</p>
</template>
