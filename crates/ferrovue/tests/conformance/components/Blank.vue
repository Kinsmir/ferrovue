<script setup lang="ts">
/* A component that may render nothing but its `v-if` comment: in a slot, it is content all the same. */
defineProps<{ show: boolean }>();
</script>

<template>
  <b v-if="show">shown</b>
</template>
