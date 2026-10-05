<script setup lang="ts">
import { ClientOnly } from "ferrovue/client";
import PlainBox from "./PlainBox.vue";

defineProps<{ tag: "div" | "section"; label: string; on: boolean }>();
</script>

<template>
  <component :is="tag" dataRole="casing">
    <p dataFoo="x" aria-Label="y" viewBox="0 0 1 1" :dataBar="label">a</p>
    <svg viewBox="0 0 10 10" :baseProfile="label"><foreignObject fooBar="1"><p fooBaz="2">x</p></foreignObject></svg>
    <p class=" a " :class="{ on }" style="color: red" :style="{ width: on ? '1px' : undefined }">m</p>
    <p :class="{ on }" class="b">n</p>
    <select><option :selected="on" value="">o</option><option :selected="!on" value="b">b</option></select>
    <PlainBox :text="label"><span fooBar="1" :dataQ="label">{{ label }}</span></PlainBox>
    <ClientOnly><i>client</i></ClientOnly>
  </component>
</template>
