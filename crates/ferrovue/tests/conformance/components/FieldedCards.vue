<script setup lang="ts">
import type { Fielded } from "../types/fielded";
import FieldedCard from "./FieldedCard.vue";

defineProps<{ lead: Fielded; cards: Fielded[] }>();
</script>

<template>
  <section>
    <FieldedCard :card="lead" :rest="cards" />
    <FieldedCard v-for="(c, i) in cards" :key="i" :card="c" />
  </section>
</template>
