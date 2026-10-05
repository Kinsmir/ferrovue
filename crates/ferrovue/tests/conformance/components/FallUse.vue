<script setup lang="ts">
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
