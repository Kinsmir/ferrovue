<script setup lang="ts">
/* Reads the Pinia store on the server: its state and its getters. */
import { storeToRefs } from "pinia";
import { useBasket } from "../stores/basket";

defineProps<{ label: string }>();
const basket = useBasket();
const { count, empty } = storeToRefs(basket);
</script>

<template>
  <p class="basket" :class="{ empty }">{{ label }} of {{ basket.owner }}: <b>{{ count }}</b> {{ count === 1 ? "book" : "books" }}</p>
</template>
