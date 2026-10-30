<script setup lang="ts">
import { computed } from "vue";
interface Tally {
  n: number;
  tags: string[];
}
const props = defineProps<{ a?: string; b: string; bs: string[] }>();
const pick = computed(() => (props.a ? (props.b.length ? props.a : props.b) : "none"));
const both = computed(() => (props.a ? [props.a, props.b] : []));
const built = computed(() => {
  if (props.a) {
    const r: Tally = { n: props.bs.length, tags: props.bs };
    return [props.a, r.n > 0 ? "some" : "none"];
  }
  const q: Tally = { n: props.bs.length + 1, tags: props.bs };
  return [props.b, q.n > 1 ? "some" : "none"];
});
</script>

<template>
  <div>
    <b v-if="pick">[{{ pick }}]</b>
    <i v-else>empty</i>
    <component is="em" :title="pick" />
    <template v-for="x in both">
      <s v-if="x">{{ x }}</s>
      <u v-else>none</u>
      <component is="q" :title="x" />
    </template>
    <template v-for="x in built">
      <s v-if="x">{{ x }}</s>
      <u v-else>none</u>
    </template>
  </div>
</template>
