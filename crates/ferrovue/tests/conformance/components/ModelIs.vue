<script setup lang="ts">
const mark = defineModel<"b" | "i" | "em">({ required: true });
const heading = defineModel<"h2" | "h3">("heading", { default: "h3" });
defineProps<{ label: string }>();
</script>

<template>
  <section :title="label">
    <component :is="heading" :class="mark">{{ label }}</component>
    <component :is="mark" :data-heading="heading">{{ label }} {{ mark }}</component>
    <component :is="modelValue === 'b' ? 'strong' : mark" />
  </section>
</template>
