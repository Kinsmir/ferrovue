<script setup lang="ts">
/* The expressions a template computes with: arithmetic and comparison of integers, template
 * literals, optional chaining, string and list methods, `Math`, array literals and ranges. */
interface Author {
  name: string;
  site?: string;
}
interface Row {
  id: number;
  label: string;
}

defineProps<{ n: number; m: number; name: string; tags: string[]; nums: number[]; author?: Author; rows: Row[]; pick?: string }>();
</script>

<template>
  <div>
    <p>{{ n - m }}|{{ n * m }}|{{ n % 2 }}|{{ -n }}|{{ n > m }}|{{ n <= m }}|{{ Math.max(n, m, 0) }}|{{ Math.min(n, m) }}|{{ Math.abs(m) }}</p>
    <p :title="`${name} has ${n} item${n === 1 ? '' : 's'}`">{{ `[${name}]` }}|{{ String(n) }}|{{ n.toString() }}</p>
    <p>{{ name.toUpperCase() }}|{{ name.toLowerCase() }}|{{ name.trimStart() }}|{{ name.trimEnd() }}|{{ name.includes("a") }}|{{ name.startsWith("A") }}|{{ name.endsWith("!") }}</p>
    <p>{{ tags.join(", ") }}|{{ tags.join() }}|{{ nums.join("-") }}|{{ tags.includes("x") }}|{{ nums.includes(2) }}</p>
    <p>{{ author?.name }}|{{ author?.site }}|{{ author?.site ?? "no site" }}<i v-if="pick === 'a'">picked a</i><i v-if="pick !== undefined">picked</i></p>
    <ol><li v-for="i in 3">{{ i }}</li><li v-for="(i, k) in m" :data-k="k">{{ i }}</li></ol>
    <ul><li v-for="w in ['one', name, 'three']">{{ w }}</li><li v-for="({ id, label }, i) in rows" :data-id="id">{{ i }}:{{ label }}</li></ul>
    <b v-if="n % 2 === 0 && n >= 2">even, at least two</b>
  </div>
</template>
