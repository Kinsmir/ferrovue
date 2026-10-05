<script setup lang="ts">
import { ref } from "vue";
import Model from "./Model.vue";

const props = defineProps<{ initial: string; open: boolean }>();
const text = ref(props.initial);
const isOpen = ref(props.open);
</script>

<template>
  <section><Model v-model="text" v-model:open="isOpen" /><Model v-model="text" :level="1" /></section>
</template>
