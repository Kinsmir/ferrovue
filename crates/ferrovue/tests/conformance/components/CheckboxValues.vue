<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ state: string; on: string; off: string }>();
const s = ref(props.state);
</script>

<template>
  <form>
    <input type="checkbox" v-model="s" true-value="yes" false-value="no" />
    <input type="checkbox" v-model="s" :true-value="on" :false-value="off" />
    <input type="checkbox" v-model="s" :true-value="on" />
  </form>
</template>
