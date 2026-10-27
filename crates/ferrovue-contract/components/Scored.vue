<script setup lang="ts">
export type Score = [label: string, points: number];

defineProps<{ score: Score; extra?: [string, boolean | null] }>();
</script>

<template>
  <p :title="score[0]">{{ score[1] }}<b v-if="extra">{{ extra[0] }} {{ extra[1] }}</b></p>
</template>
