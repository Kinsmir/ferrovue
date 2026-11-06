<script setup lang="ts">
defineProps<{ kind: string }>();
</script>

<template>
  <button :class="kind">
    <slot>
      fallback
    </slot>
    <slot name="after" :kind="kind" />
  </button>
</template>
