<script setup lang="ts">
/* An island: the server renders it from its props alone, and the client hydrates it and makes it
 * work. The store is reached only when the button is clicked, so the server render needs no store
 * state, and the click lands in the one Pinia every island shares. */
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
