<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import { useHead } from "@unhead/vue";
import HeadLeaf from "./HeadLeaf.vue";
import HeadNest from "./HeadNest.vue";

const LazyNest = defineAsyncComponent(() => import("./HeadNest.vue"));
const LazyLeaf = defineAsyncComponent({ loader: () => import("./HeadLeaf.vue") });
const props = defineProps<{ site: string; names: string[] }>();
useHead({ titleTemplate: `%s | ${props.site}`, meta: [{ name: "root", content: props.site }] });
</script>

<template>
  <div>
    <LazyNest name="a" />
    <HeadLeaf name="s1" />
    <HeadNest name="n" />
    <LazyLeaf v-for="n in names" :key="n" :name="n" />
    <HeadLeaf name="s2"><LazyLeaf name="in-slot" /></HeadLeaf>
  </div>
</template>
