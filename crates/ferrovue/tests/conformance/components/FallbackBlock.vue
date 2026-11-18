<script setup lang="ts">
const props = defineProps<{ s: string; on: string | null }>();

function lowered(): string {
  let acc = "";
  for (const c of props.s) {
    acc += c;
  }
  return props.s.toLowerCase();
}
</script>

<template>
  <strong :class="on ? ((s || undefined) ?? lowered()) : 'a'"></strong>
</template>
