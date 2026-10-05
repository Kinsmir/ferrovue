<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ label: string; start: number }>();
const count = ref(props.start);
</script>

<template>
  <button type="button" @click="count++">{{ label }}: {{ count }}</button>
</template>
