<script setup lang="ts">
import { CHOICES } from "../types/models";

defineProps<{ picked: number }>();
</script>

<template>
  <ul>
    <li v-for="choice in CHOICES" :key="choice.id" :class="{ picked: choice.id === picked }">{{ choice.label }}</li>
  </ul>
</template>
