<script setup lang="ts">
/* `v-show` on the root, merged with a static style and a binding that set the same property. */
defineProps<{ on: boolean; color: string }>();
</script>

<template>
  <p class="shown" style="display: block; color: red" :style="{ color }" :class="{ on }" v-show="on">x</p>
</template>
