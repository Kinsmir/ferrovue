<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ text: string; part: string; at: number; limit: number; size?: number }>();
const firstTwo = computed(() => props.text.split(" ", 2));
const tail = computed(() => props.text.substr(-props.at));
const codes = computed(() => [props.text.charCodeAt(0), props.text.charCodeAt(props.at)]);
</script>

<template>
  <section :data-from="text.indexOf(part, at)">
    <p>{{ text.includes(part, at) }}|{{ text.includes("a", -5) }}|{{ text.includes(part, Infinity) }}|{{ text.startsWith(part, at) }}|{{ text.startsWith("", 1) }}|{{ text.endsWith(part, at) }}|{{ text.endsWith(part, size) }}</p>
    <p>{{ text.indexOf(part, at) }}|{{ text.indexOf("", at) }}|{{ text.indexOf(part, 0 / 0) }}|{{ text.lastIndexOf(part, at) }}|{{ text.lastIndexOf(part, -1) }}|{{ text.lastIndexOf("", at) }}|{{ text.lastIndexOf(part, size) }}</p>
    <p>{{ text.split("", limit).length }}|{{ text.split(" ", limit).length }}|{{ firstTwo.join("+") }}|{{ text.split(part, -1).length }}|{{ text.split(",", 4294967297).join(";") }}|{{ text.split(",", 0).length }}</p>
    <p>{{ text.substr(at) }}|{{ text.substr(0, 2) }}|{{ tail }}|{{ text.substr(at, limit) }}|{{ text.substr(-2, size) }}|{{ text.substr(0, -1) === "" }}</p>
    <p>{{ text.trimLeft() }}|{{ text.trimRight() }}|{{ text.trimLeft().length }}|{{ text.concat(part, "!", text) }}|{{ part.concat() }}</p>
    <p>{{ text.includes("a", 1) }}|{{ text.startsWith("a", 1) }}|{{ text.endsWith("🦀", 1) }}|{{ text.indexOf("", 1) }}|{{ text.indexOf("a", 1) }}|{{ text.lastIndexOf("🦀", 1) }}|{{ text.charCodeAt(1) }}|{{ text.codePointAt(1) }}</p>
    <p>{{ text.charCodeAt(at) }}|{{ text.charCodeAt() }}|{{ text.codePointAt(at) }}|{{ text.codePointAt(at) ?? -1 }}|{{ text.codePointAt(99) === undefined }}|{{ codes.join(",") }}</p>
    <ul><li v-for="(w, i) in text.split(' ', limit)" :key="i">{{ w.charCodeAt(0) }}:{{ w.codePointAt(0) }}</li></ul>
  </section>
</template>
