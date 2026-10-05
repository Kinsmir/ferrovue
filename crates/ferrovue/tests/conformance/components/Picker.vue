<script setup lang="ts" generic="T extends Choice, K extends string, M extends string | null">
import type { Choice } from "../types/catalog";

const props = defineProps<{ items: T[]; heading: K; selected?: K; mark: M }>();
</script>

<template>
  <fieldset>
    <legend>{{ heading }}<small v-if="mark !== null"> {{ mark }}</small></legend>
    <label v-for="item in props.items" :key="item.id" :class="{ on: item.label === selected }" :title="item.hint">{{ item.label }} #{{ item.id }}</label>
  </fieldset>
</template>
