<script setup lang="ts">
defineProps<{ to: string }>();
</script>

<template>
  <RouterLink :to="to" active-class=" on " exact-active-class="on">go</RouterLink>
</template>
