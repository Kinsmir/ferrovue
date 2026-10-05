<script setup lang="ts">
defineProps<{ input: string; inputs: string[]; flag: boolean; n: number }>();
</script>

<template>
  <section>
    <p>{{ Number(input) }}|{{ parseInt(input) }}|{{ parseInt(input, 10) }}|{{ parseInt(input, 16) }}|{{ parseFloat(input) }}|{{ Number(flag) }}|{{ Number(n) }}</p>
    <p :data-n="Number(input) * 2">{{ Number(input) + 1 }}|{{ parseFloat(input).toFixed(2) }}|{{ Number(input) > 10 }}|{{ Math.round(parseFloat(input)) }}</p>
    <p>{{ inputs.map((s) => Number(s)).filter((x) => x > 0).join(", ") }}|{{ inputs.map((s) => parseInt(s, 10)).join() }}|{{ inputs.map((s) => parseFloat(s)).join(" ") }}</p>
    <p>{{ JSON.stringify(inputs) }}|{{ JSON.stringify(input) }}|{{ JSON.stringify(Number(input)) }}|{{ JSON.stringify(flag) }}|{{ JSON.stringify(n) }}</p>
  </section>
</template>
