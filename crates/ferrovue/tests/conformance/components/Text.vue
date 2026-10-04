<script setup lang="ts">
/* Interpolation: every scalar type, absent values, and the expressions a template computes text with. */
const props = defineProps<{ title: string; count: number; on: boolean; note?: string; score?: number; padded: string }>();
</script>

<template>
  <p><b>{{ title }}</b>|{{ count }}|{{ on }}|{{ note }}|{{ score }}|{{ padded.trim() }}|{{ padded.length }}|{{ '#' + count }}|{{ count + 1 }}|{{ title + '!' }}|{{ note ?? 'none' }}|{{ title || 'untitled' }}|{{ on ? 'yes' : 'no' }}|{{ score ?? count }}|{{ count ? 'some' : 'zero' }}</p>
</template>
