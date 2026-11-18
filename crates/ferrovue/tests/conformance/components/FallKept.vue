<script setup lang="ts">
import FallLeaf from "./FallLeaf.vue";

defineProps<{ tone: string }>();
</script>

<template>
  <section>
    <FallLeaf label="kept" :data-x="'a'.repeat(3).concat('ß')" :title="`${tone.repeat(2)}!`" />
  </section>
</template>
