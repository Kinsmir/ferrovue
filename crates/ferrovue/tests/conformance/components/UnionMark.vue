<script setup lang="ts">
import { Mark } from "../types/marks";

defineProps<{ mark?: Mark; label: string }>();
</script>

<template>
  <em :data-mark="mark">{{ label }} {{ mark }}</em>
</template>
