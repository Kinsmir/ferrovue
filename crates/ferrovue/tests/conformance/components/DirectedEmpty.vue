<script setup lang="ts">
import { vFocus } from "./directives";

defineProps<{ id: string; label: string; items: string[] }>();
</script>

<template>
  <div class="directed">
    <p>{{ label }}</p>
    <b v-focus />
    <b v-focus class="x" :id="id" :title="label" />
    <ul>
      <li v-for="item in items" :key="item"><i v-focus :data-item="item" /></li>
    </ul>
    <span>{{ id }}</span>
  </div>
</template>
