<script setup lang="ts">
/* A `<Transition>` root around one component: the attributes pass through both to its root. */
import FallLeaf from "./FallLeaf.vue";

defineProps<{ text: string }>();
</script>

<template>
  <Transition name="fade">
    <FallLeaf :label="text" class="faded" />
  </Transition>
</template>
