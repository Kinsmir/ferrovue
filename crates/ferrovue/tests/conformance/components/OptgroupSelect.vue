<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ picked: string; group: string; extra: string[] }>();
const p = ref(props.picked);
</script>

<template>
  <form>
    <select v-model="p">
      <option value="">none</option>
      <optgroup label="fruit"><option value="apple">apple</option><option value="pear">pear</option></optgroup>
      <optgroup label="closed" disabled><option value="plum">plum</option></optgroup>
      <optgroup :label="group">
        <option v-for="e in extra" :key="e" :value="e">{{ e }}</option>
        <option v-if="group" :value="group">{{ group }}</option>
      </optgroup>
    </select>
  </form>
</template>
