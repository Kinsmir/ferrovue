<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useCart } from "../stores/cart";
import { usePrefs } from "../stores/prefs";

defineProps<{ heading: string }>();
const cart = useCart();
const prefs = usePrefs();
const { lines, empty, label } = storeToRefs(cart);
const { doubled } = storeToRefs(prefs);
const summary = computed(() => `${cart.lines.length} line(s), ${doubled.value} doubled`);
</script>

<template>
  <aside :class="{ compact: prefs.compact, empty }">
    <h3>{{ heading }}: {{ label }}</h3>
    <p v-if="empty">nothing yet</p>
    <ul v-else><li v-for="l in lines" @click="cart.add(l.sku)">{{ l.sku }} × {{ l.qty }}</li></ul>
    <p>{{ summary }}|{{ prefs.tagCount }}|{{ cart.discounted ? cart.coupon : "no coupon" }}</p>
  </aside>
</template>
