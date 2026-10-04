<script setup lang="ts">
/* A parent binding a child's models with `v-model`, which on the server hands the child its value. */
import { ref } from "vue";
import Model from "./Model.vue";

const props = defineProps<{ initial: string; open: boolean }>();
const text = ref(props.initial);
const isOpen = ref(props.open);
</script>

<template>
  <section><Model v-model="text" v-model:open="isOpen" /><Model v-model="text" :level="1" /></section>
</template>
