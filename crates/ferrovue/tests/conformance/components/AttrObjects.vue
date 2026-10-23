<script setup lang="ts">
import type { Float } from "ferrovue/types";

defineProps<{
  label: string;
  count: number;
  ratio: Float;
  limit?: number;
  maybe?: string;
  css: string;
}>();
</script>

<template>
  <div>
    <p v-bind="{ 'a.': label, 'data-icon-name': label, onx: label, title: '' }">keys</p>
    <p v-bind="{ hidden: count }">count</p>
    <p v-bind="{ hidden: ratio }">ratio</p>
    <p v-bind="{ hidden: limit }">limit</p>
    <p class="a" v-bind="{ class: 'b' }">two</p>
    <p class="a" v-bind="{ class: 'a' }">once</p>
    <p :class="maybe" v-bind="{ id: label }">merged</p>
    <p v-bind="{ class: maybe }">alone</p>
    <p :class="maybe" v-bind="{ class: undefined }">absent</p>
    <p :class="undefined" v-bind="{ id: label }">none</p>
    <p v-bind="{ style: css }">style</p>
    <p :style="css" v-bind="{ id: label }">merged style</p>
  </div>
</template>
