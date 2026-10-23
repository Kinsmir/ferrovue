<script setup lang="ts">
export interface Props {
  label: string;
  children: Props[];
}

defineProps<Props>();
</script>

<template>
  <li class="node">{{ label }}<ul v-if="children.length"><kebab-tree v-for="c in children" v-bind="c" /></ul><ul v-if="label === 'root'"><kebabTree label="end" :children="[]" /></ul></li>
</template>

<style scoped>
.node {
  margin: 0;
}
</style>
