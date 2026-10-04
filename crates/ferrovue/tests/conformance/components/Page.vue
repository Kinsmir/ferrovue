<script setup lang="ts">
/* Slot content as a parent writes it: a heading that may be only a comment, so the fallback shows,
 * and a body that is a list, empty or not. */
import Frame from "./Frame.vue";

defineProps<{ title: string; items: string[]; showHead: boolean; note?: string }>();
</script>

<template>
  <Frame :title="title"><template #head><b v-if="showHead">{{ title }}</b></template><p v-for="i in items">{{ i }}</p><em v-if="note">{{ note }}</em></Frame>
</template>
