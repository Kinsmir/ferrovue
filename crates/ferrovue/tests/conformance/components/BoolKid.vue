<script setup lang="ts">
defineProps<{ flag: boolean; opt?: boolean; fooBar?: boolean; label: string }>();
</script>

<template>
  <p :data-flag="flag" :data-opt="opt" :data-foo-bar="fooBar">{{ label }}: {{ flag }} {{ opt }} {{ fooBar }} {{ opt === undefined }}</p>
</template>
