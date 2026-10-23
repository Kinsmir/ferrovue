<script setup lang="ts">
defineProps<{
  label: string;
  note?: string;
}>();
</script>

<template>
  <div>
    <p v-bind="{ '^title': label, 'a^': label, '.value': label }">keys</p>
    <p v-bind="{ hidden: label, disabled: note, inert: label, open: true, required: false }">booleans</p>
  </div>
</template>
