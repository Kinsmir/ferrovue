<script setup lang="ts">
export interface Props {
  label: string;
  children: Props[];
}

defineProps<Props>();
</script>

<template>
  <li class="node">{{ label }}<ul v-if="children.length"><ScopedTree v-for="c in children" v-bind="c" /></ul></li>
</template>

<style scoped>
.node {
  list-style: square;
}
</style>
