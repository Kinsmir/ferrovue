<script setup lang="ts">
/* String methods counted in UTF-16 code units, as JavaScript counts them — slicing, searching,
 * splitting, replacing with `$` patterns, padding, repeating — and strings ordered by code unit. */
import { computed } from "vue";

const props = defineProps<{ text: string; other: string; sep: string; n: number; width: number; fill?: string }>();
const initial = computed(() => props.text.charAt(0).toUpperCase());
const words = computed(() => props.text.split(" "));
const short = computed(() => props.text.slice(0, 3));
const last = computed(() => props.text.toUpperCase().at(-1));
</script>

<template>
  <section>
    <p>{{ text.slice(0, 5) }}|{{ text.slice(-3) }}|{{ text.slice(n, -n) }}|{{ text.slice() }}|{{ text.substring(4, 2) }}|{{ text.substring(n) }}</p>
    <p>{{ text.at(0) }}|{{ text.at(-1) ?? "none" }}|{{ text.charAt(n) }}|{{ initial }}|{{ text.charAt(99) }}|{{ text.at(n - 100) === undefined }}</p>
    <p>{{ text.indexOf(other) }}|{{ text.lastIndexOf("a") }}|{{ text.indexOf("") }}|{{ other.indexOf(text) }}|{{ text.slice(text.indexOf(" ") + 1) }}</p>
    <ul><li v-for="(w, i) in text.split(sep)" :data-i="i">{{ w }}</li></ul>
    <p>{{ words.length }}|{{ text.split(",").join(" / ") }}|{{ words.filter((w) => w.length > 2).join("+") }}|{{ text.split(sep).length }}</p>
    <p>{{ text.replace(other, "[$&]") }}|{{ text.replaceAll("a", "$$") }}|{{ text.replace("", "^") }}|{{ text.replaceAll(sep, "$`|$'") }}|{{ text.replace("a", "$1") }}</p>
    <p :title="String(n).padStart(width, '0')">{{ text.padStart(width, fill ?? ".") }}|{{ text.padEnd(width) }}|{{ "ab".repeat(n) }}|{{ text.repeat(2) }}</p>
    <p>{{ text < other }}|{{ text > other }}|{{ text <= other }}|{{ text >= other }}|{{ other < "～" }}|{{ text.slice(0, 1) < "b" }}</p>
    <p>{{ short }}|{{ last ?? "-" }}|{{ n > 1 ? text.toUpperCase().at(1) : undefined }}|{{ short.length < 3 ? short.padEnd(3, "_") : short }}</p>
    <b v-if="text.slice(0, 1) === 'a'">starts with a</b>
    <p>{{ text.slice(1).toLowerCase() || "-" }}|{{ other.replace("a", "b").toUpperCase() || sep }}|{{ ((text.split(" ").find((w) => w === sep) ?? "ß") + "a") || "-" }}</p>
  </section>
</template>
