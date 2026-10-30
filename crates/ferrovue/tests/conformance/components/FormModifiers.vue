<script setup lang="ts">
import { ref } from "vue";
import type { Float } from "ferrovue/types";

const props = defineProps<{ count: number; price: Float; amount: string; name: string; note: string }>();
const n = ref(props.count);
const p = ref(props.price);
const a = ref(props.amount);
const who = ref(props.name);
const body = ref(props.note);
</script>

<template>
  <form>
    <input type="number" v-model.number="n" />
    <input v-model.number="p" name="price" />
    <input v-model.number="a" name="amount" />
    <input v-model.trim="who" name="who" />
    <input v-model.trim.lazy="who" type="search" />
    <input v-model.number.trim="a" />
    <textarea v-model.trim="body"></textarea>
  </form>
</template>
