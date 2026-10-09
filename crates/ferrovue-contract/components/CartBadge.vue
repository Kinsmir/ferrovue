<script setup lang="ts">
import { useCart } from "../stores/cart";

const cart = useCart();
</script>

<template>
  <b class="badge">{{ cart.lines.length }} for {{ cart.owner }}</b>
</template>
