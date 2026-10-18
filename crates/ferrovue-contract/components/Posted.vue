<script setup lang="ts">
defineProps<{ at: Date; edited?: Date; deleted: Date | null }>();
</script>

<template>
  <time :datetime="at.toISOString()">{{ at.getUTCFullYear() }}<b v-if="edited">{{ edited.getTime() }}</b><i v-if="deleted">{{ deleted.getUTCDate() }}</i></time>
</template>
