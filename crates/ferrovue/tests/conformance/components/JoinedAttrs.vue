<script setup lang="ts">
defineProps<{ words: string[]; nums: number[] }>();
</script>

<template>
  <p :title="words.join('-')" :data-glued="words.join('')" :data-nums="nums.join(',')" :data-default="words.join()">x</p>
</template>
