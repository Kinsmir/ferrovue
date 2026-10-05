<script setup lang="ts">
import Frame from "./Frame.vue";

defineProps<{ title: string; items: string[]; showHead: boolean; note?: string }>();
</script>

<template>
  <Frame :title="title"><template #head><b v-if="showHead">{{ title }}</b></template><p v-for="i in items">{{ i }}</p><em v-if="note">{{ note }}</em></Frame>
</template>
