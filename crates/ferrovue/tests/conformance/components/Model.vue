<script setup lang="ts">
const text = defineModel<string>({ required: true });
const open = defineModel<boolean>("open");
const level = defineModel<number>("level", { default: 3 });
</script>

<template>
  <div><input v-model="text" /><input type="checkbox" v-model="open" /><span :data-level="level">{{ text }}</span><b v-if="open">open</b></div>
</template>
