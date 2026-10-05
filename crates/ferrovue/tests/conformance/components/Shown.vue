<script setup lang="ts">
defineProps<{ on: boolean; color: string }>();
</script>

<template>
  <p class="shown" style="display: block; color: red" :style="{ color }" :class="{ on }" v-show="on">x</p>
</template>
