<script setup lang="ts">
/* A root chosen by `v-if`: whichever is rendered takes the attributes, and the comment left when
 * none is takes nothing. */
defineProps<{ mode: "on" | "off" | "none" }>();
</script>

<template>
  <b v-if="mode === 'on'" class="on" title="own">on</b>
  <i v-else-if="mode === 'off'">off</i>
</template>
