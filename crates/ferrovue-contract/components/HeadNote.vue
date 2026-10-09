<script setup lang="ts">
import { useHead } from "@unhead/vue";

const props = defineProps<{ title: string }>();
useHead({ title: props.title });
</script>

<template>
  <i>{{ title }}</i>
</template>
