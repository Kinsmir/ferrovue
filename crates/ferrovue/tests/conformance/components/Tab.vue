<script setup lang="ts">
import { inject } from "vue";
import { SelectKey, TabsKey } from "../types/keys";

defineProps<{ name: string; title: string }>();
const tabs = inject(TabsKey);
const select = inject(SelectKey, () => {});
</script>

<template>
  <section v-if="tabs?.active === name" class="tab active" :data-of="tabs?.count">{{ title }}</section>
  <button v-else type="button" class="tab" @click="select(name)">{{ title }}</button>
</template>
