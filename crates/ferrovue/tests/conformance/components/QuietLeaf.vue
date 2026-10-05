<script setup lang="ts">
defineOptions({ inheritAttrs: false });
defineProps<{ note: string }>();
</script>

<template>
  <small class="quiet">{{ note }}</small>
</template>
