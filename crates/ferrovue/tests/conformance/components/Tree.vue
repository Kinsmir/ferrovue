<script setup lang="ts">
export interface Props {
  label: string;
  children: Props[];
}

defineProps<Props>();
</script>

<template>
  <li>{{ label }}<ul v-if="children.length"><Tree v-for="c in children" v-bind="c" /></ul></li>
</template>
