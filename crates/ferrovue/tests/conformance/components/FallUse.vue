<script setup lang="ts">
/* `useAttrs()`, bound whole to a chosen element, and to a child component; a root of its own with
 * nothing to merge. */
import { useAttrs } from "vue";
import FallPair from "./FallPair.vue";

defineOptions({ inheritAttrs: false });
const attrs = useAttrs();
</script>

<template>
  <section>
    <em v-bind="attrs">used</em>
    <dl><FallPair first="pair" v-bind="attrs" /></dl>
  </section>
</template>
