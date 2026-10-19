<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";

const props = defineProps<{ n: number; x: Float; maybe?: Float; count?: number; inputs: string[] }>();
const parsed = computed(() => props.inputs.map((s) => Number(s)));
const finite = computed(() => Number.isFinite(props.x / props.n));
const kept = computed(() => parsed.value.filter((v) => !Number.isNaN(v) && Number.isFinite(v)));
</script>

<template>
  <section>
    <p>{{ Number.isNaN(n) }}|{{ Number.isFinite(n) }}|{{ Number.isInteger(n) }}|{{ Number.isSafeInteger(n) }}|{{ isNaN(n) }}|{{ isFinite(n) }}</p>
    <p>{{ Number.isNaN(x) }}|{{ Number.isFinite(x) }}|{{ Number.isInteger(x) }}|{{ Number.isSafeInteger(x) }}|{{ isNaN(x) }}|{{ isFinite(x) }}</p>
    <p :data-finite="Number.isFinite(x / n)" :data-nan="Number.isNaN(x % n)" :hidden="!Number.isInteger(x * 2)">{{ finite }}|{{ Number.isFinite(maybe) }}|{{ Number.isInteger(maybe) }}|{{ Number.isNaN(maybe) }}|{{ Number.isSafeInteger(count) }}|{{ Number.isInteger(count) }}</p>
    <p v-show="Number.isSafeInteger(x)">{{ Number.isNaN(0 / 0) }}|{{ Number.isFinite(1 / 0) }}|{{ Number.isInteger(-0) }}|{{ Number.isSafeInteger(9007199254740992) }}|{{ Number.isInteger(0.5) }}</p>
    <b v-if="Number.isNaN(x / n)">not a number</b>
    <b v-else-if="!Number.isFinite(x / n)">infinite</b>
    <b v-else>{{ x / n }}</b>
    <ul>
      <li v-for="s in inputs" :key="s" :class="{ nan: Number.isNaN(Number(s)), whole: Number.isInteger(Number(s)) }">{{ s }} is {{ Number(s) }}: {{ Number.isNaN(Number(s)) }}|{{ Number.isFinite(Number(s)) }}|{{ Number.isInteger(Number(s)) }}|{{ Number.isSafeInteger(Number(s)) }}|{{ isNaN(Number(s)) }}|{{ isFinite(parseFloat(s)) }}|{{ !Number.isNaN(Number(s)) && Number(s) > 0 }}|{{ Number.isFinite(Number(s)) || Number.isNaN(Number(s)) }}</li>
    </ul>
    <p>{{ kept.join(", ") }}|{{ parsed.some((v) => Number.isNaN(v)) }}|{{ parsed.filter((v) => Number.isSafeInteger(v)).length }}</p>
  </section>
</template>
