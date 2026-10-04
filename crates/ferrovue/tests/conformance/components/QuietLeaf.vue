<script setup lang="ts">
/* `inheritAttrs: false` with no scoped styles of its own: the ids its parent passes on are dropped,
 * while its parent's own id still reaches its root. */
defineOptions({ inheritAttrs: false });
defineProps<{ note: string }>();
</script>

<template>
  <small class="quiet">{{ note }}</small>
</template>
