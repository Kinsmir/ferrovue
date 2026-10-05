<script setup lang="ts">
import { computed, useSlots } from "vue";

defineProps<{ title: string }>();
const slots = useSlots();
const closing = computed(() => !!slots.footer);
</script>

<template>
  <section>
    <header v-if="slots.header"><slot name="header" /></header>
    <h3 v-else>{{ title }}</h3>
    <slot />
    <footer v-if="closing"><slot name="footer" /></footer>
    <small v-else>no footer</small>
  </section>
</template>
