<script setup lang="ts">
import { useHead } from "@unhead/vue";

const props = defineProps<{ name: string }>();
useHead({ title: props.name, meta: [{ name: props.name, content: props.name }], bodyAttrs: { class: props.name } });
</script>

<template>
  <i>{{ name }}<slot /></i>
</template>
