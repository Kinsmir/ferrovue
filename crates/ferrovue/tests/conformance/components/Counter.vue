<script setup lang="ts">
/* A setup store read through the store and `storeToRefs`: its refs and its computeds, one reading
 * another. */
import { storeToRefs } from "pinia";
import { useCounter } from "../stores/counter";

defineProps<{ title: string }>();
const counter = useCounter();
const { count, summary } = storeToRefs(counter);
</script>

<template>
  <div :data-count="count" @click="counter.increment()">
    <h4>{{ title }}: {{ counter.label }}</h4>
    <p>{{ count }}|{{ counter.doubled }}|{{ summary }}|{{ counter.step }}|{{ counter.history.length }}<b v-if="counter.owner">{{ counter.owner }}</b></p>
  </div>
</template>
