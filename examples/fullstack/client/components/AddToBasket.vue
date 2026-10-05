<script setup lang="ts">
import { ref } from "vue";
import { useBasket } from "../stores/basket";

const props = defineProps<{ id: string; title: string }>();
const added = ref(false);

function add(): void {
  useBasket().add(props.id);
  added.value = true;
}
</script>

<template>
  <button type="button" class="add" :aria-label="`Add ${title} to the basket`" :disabled="added" @click="add">{{ added ? "In the basket" : "Add to basket" }}</button>
</template>
