<script setup lang="ts">
defineProps<{ label: string; size?: number }>();
</script>

<template>
  <b class="square" :data-size="size">{{ label }}<slot /><slot name="corner">·</slot></b>
</template>
