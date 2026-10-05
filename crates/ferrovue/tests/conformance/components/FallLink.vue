<script setup lang="ts">
/* A `<RouterLink>` root: the attributes a parent passes reach the `<a>` vue-router renders, after
 * its own and the template's. */
defineProps<{ to: string }>();
</script>

<template>
  <RouterLink :to="to" class="link" title="own">go</RouterLink>
</template>
