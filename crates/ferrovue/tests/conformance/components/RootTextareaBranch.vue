<script setup lang="ts">
defineProps<{ editing: boolean; hint: string; lines: string[] }>();
</script>

<template>
  <textarea v-if="editing" :placeholder="hint">Write <b>here</b> &amp; "now"</textarea>
  <p v-else :title="hint">
    <i v-for="line in lines" :key="line">{{ line }}</i>
  </p>
</template>
