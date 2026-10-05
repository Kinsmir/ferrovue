<script setup lang="ts">
defineProps<{ color: string; size: number; shown: boolean; hidden: boolean; raw: string; accent?: string; width?: number; big: boolean }>();
</script>

<template>
  <div v-show="shown">
    <p :style="{ color, fontSize: size + 'px', lineHeight: 1.5, '--gap': size, opacity: 0.5 }">a</p>
    <p style="margin: 0; color: black" :style="{ color: accent, borderWidth: width }">b</p>
    <p :style="[{ display: 'flex' }, big ? { display: 'grid', gap: '1rem' } : null, { WebkitLineClamp: size }]">c</p>
    <p :style="raw">d</p>
    <p :style="'top: 0'">e</p>
    <p style="display: block" v-show="!hidden">f</p>
    <p v-show="hidden" :style="{ color }">g</p>
    <p :style="big && { fontWeight: 'bold' }">h</p>
    <p :style="{ color: big, width: accent }">i</p>
  </div>
</template>

<style>
.unused-by-the-server { color: red; }
</style>
