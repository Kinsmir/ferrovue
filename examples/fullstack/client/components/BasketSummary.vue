<script setup lang="ts">
/* Reads the Pinia store on the server: its state and its getters. Its styles are scoped. */
import { storeToRefs } from "pinia";
import { useBasket } from "../stores/basket";

defineProps<{ label: string }>();
const basket = useBasket();
const { count, empty } = storeToRefs(basket);
</script>

<template>
  <p class="basket" :class="{ empty }">{{ label }} of {{ basket.owner }}: <b>{{ count }}</b> {{ count === 1 ? "book" : "books" }}</p>
</template>

<style scoped>
.basket {
  margin: 0;
}
.empty b {
  color: var(--muted);
}
</style>
