<script setup lang="ts">
defineProps<{ shape: string; head: string; bar: number; count: number; on: boolean; extra: string; who?: string; both: string }>();
</script>

<template>
  <div class="card" :class="['mosaic', 'mosaic-' + shape, extra]">
    <a :class="[on && 'on', extra, 'mosaic-' + shape, extra]">{{ count ? 'more (' + count + ')' : 'more' }}</a>
    <a :class="[extra, head + '-head', on ? 'lit' : extra + shape]">{{ who ? 'hi ' + who : 'nobody' }}</a>
    <span :class="'inline-block bar-' + bar" :title="!who ? 'anon ' + count : `by ${who}`">{{ !who ? 'anon' : 'by ' + who + '.' }}</span>
    <i :class="[both + shape, extra + '-' + bar]">{{ on ? (count ? count + ' left' : 'none') : 'off ' + both }}</i>
  </div>
</template>
