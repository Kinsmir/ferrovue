<script setup lang="ts">
/* `:slotted()` styles, forwarding its slot through a component without them into a third's: the
 * slot scope id the content is given holds two spaces in a row, which its elements write as they
 * are and its components' roots read as an empty id, never written. */
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
