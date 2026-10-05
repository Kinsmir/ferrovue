<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ query: string; agreed: boolean; size: string; body: string }>();
const q = ref(props.query);
const ok = ref(props.agreed);
const picked = ref(props.size);
const text = ref(props.body);
</script>

<template>
  <form>
    <input v-model="q" name="q" />
    <input type="checkbox" v-model="ok" />
    <select v-model="picked"><option value="s">small</option><option value="m">medium</option><option value="l">large</option></select>
    <label><input type="radio" value="s" v-model="picked" />s</label><label><input type="radio" value="m" v-model="picked" />m</label>
    <textarea v-model="text"></textarea>
  </form>
</template>
