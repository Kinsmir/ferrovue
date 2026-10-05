<script setup lang="ts">
import PlainForward from "./PlainForward.vue";
</script>

<template>
  <div class="rack"><PlainForward><slot /></PlainForward></div>
</template>

<style scoped>
.rack :slotted(b) {
  color: navy;
}
</style>
