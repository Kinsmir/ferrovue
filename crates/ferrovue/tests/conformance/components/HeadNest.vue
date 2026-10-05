<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import { useHead } from "@unhead/vue";
import HeadLeaf from "./HeadLeaf.vue";

const LazyLeaf = defineAsyncComponent(() => import("./HeadLeaf.vue"));
const props = defineProps<{ name: string }>();
useHead({ meta: [{ name: props.name, content: props.name }], bodyAttrs: { class: props.name } });
</script>

<template>
  <b>
    <HeadLeaf :name="`${name}-child`" />
    <LazyLeaf :name="`${name}-lazy`"><HeadLeaf :name="`${name}-slot`" /></LazyLeaf>
    <HeadLeaf :name="`${name}-after`" />
  </b>
</template>
