<script setup lang="ts">
type Mark = "" | "new";
defineProps<{ a?: string; b: string; c: boolean; s: string; t: string; m: Mark }>();
</script>

<template>
  <div>
    <p v-if="a">
      <span v-if="c ? a : b">shown</span>
      <i>{{ (c ? a : b) || "fb" }}</i>
      <component is="em" :title="c ? a : b" />
      <template v-for="x in [a, b]">
        <b v-if="x">[{{ x }}]</b>
        <i v-else>empty</i>
      </template>
      <u v-if="[b, a][0]">{{ [b, a][0] }}</u>
    </p>
    <b v-if="(s || undefined) ?? t">A</b>
    <component is="i" :title="(s || undefined) ?? t" />
    <s>{{ (s || undefined) ?? t }}</s>
    <b v-if="m ? m : m">{{ m }}</b>
    <component is="q" :title="m ? m : m" />
  </div>
</template>
