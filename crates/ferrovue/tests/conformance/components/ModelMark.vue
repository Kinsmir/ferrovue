<script setup lang="ts">
const mark = defineModel<"b">({ required: true });
const heading = defineModel<"h2">("heading", { default: "h2" });
defineProps<{ label: string }>();
</script>

<template>
  <component :is="heading" :title="label">{{ label }}</component>
  <component :is="mark" :data-mark="mark">{{ label }} {{ mark }}</component>
</template>
