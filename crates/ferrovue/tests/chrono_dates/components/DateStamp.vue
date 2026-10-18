<script setup lang="ts">
interface Props {
  at: Date;
  edited?: Date;
  deleted: Date | null;
  shown: Date;
}

defineProps<Props>();
</script>

<template>
  <footer>
    {{ at.getTime() }}|{{ shown.getUTCSeconds() }}
    <span v-if="edited">{{ edited.getTime() }}</span>
    <span v-if="deleted">{{ deleted.getUTCFullYear() }}</span>
    <span v-if="edited && deleted">both</span>
  </footer>
</template>
