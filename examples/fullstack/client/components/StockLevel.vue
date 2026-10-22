<script setup lang="ts">
import { loadStock } from "./loaders";
import Shipping from "./Shipping.vue";

const props = defineProps<{ id: string }>();
const stock = await loadStock(props.id);
</script>

<template>
  <div class="stock" :data-copies="stock.copies">
    <p v-if="stock.copies">{{ stock.copies }} {{ stock.copies === 1 ? "copy" : "copies" }} in stock</p>
    <p v-else>Out of stock</p>
    <Shipping v-if="stock.copies" :warehouse="stock.warehouse" />
  </div>
</template>
