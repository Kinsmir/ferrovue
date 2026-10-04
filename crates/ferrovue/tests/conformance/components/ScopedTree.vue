<script setup lang="ts">
/* A scoped component that renders itself: a child's root inherits the id it already writes, and
 * so carries it twice. */
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
