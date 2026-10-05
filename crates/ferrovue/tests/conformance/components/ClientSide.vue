<script setup lang="ts">
import { ClientOnly } from "ferrovue/client";
import Gauge from "../vendor/Gauge";
import PlainBox from "./PlainBox.vue";

defineProps<{ title: string; level: number; note?: string }>();
</script>

<template>
  <section class="client-side">
    <h2>{{ title }}</h2>
    <ClientOnly>
      <Gauge :level="level" />
      <template #fallback>
        <p v-if="note" class="loading">{{ note }}</p>
        <span>{{ level }}%</span>
      </template>
    </ClientOnly>
    <ClientOnly><Gauge :level="level * 2" /></ClientOnly>
    <PlainBox :text="title"><ClientOnly><Gauge :level="0" /></ClientOnly></PlainBox>
  </section>
</template>

<style scoped>
.client-side {
  display: flex;
}
</style>
