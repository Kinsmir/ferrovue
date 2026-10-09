<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template>
  <div class="host">
    <Teleport to="#modals"><h2>{{ title }}</h2></Teleport>
  </div>
</template>
