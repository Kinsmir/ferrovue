<script setup lang="ts">
import { loadWarehouse } from "./loaders";

const props = defineProps<{ warehouse: string }>();
const from = await loadWarehouse(props.warehouse);
</script>

<template>
  <p v-if="from" class="shipping">Ships from {{ from.city }} in {{ from.days }} {{ from.days === 1 ? "day" : "days" }}</p>
  <p v-else class="shipping">Ships once it reaches us</p>
</template>
