<script setup lang="ts">
defineProps<{ name: string; count: number }>();
</script>

<template>
  <p class="hello">Hello, {{ name }}<b v-if="count">{{ count }}</b></p>
</template>
