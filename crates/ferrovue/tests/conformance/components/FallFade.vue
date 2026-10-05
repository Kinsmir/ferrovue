<script setup lang="ts">
import FallLeaf from "./FallLeaf.vue";

defineProps<{ text: string }>();
</script>

<template>
  <Transition name="fade">
    <FallLeaf :label="text" class="faded" />
  </Transition>
</template>
