<script setup lang="ts">
defineProps<{ type: string; loop: boolean; crate: string; match?: string; self?: number; static?: boolean; async?: string }>();
</script>

<template>
  <section :data-type="type">
    <video :loop="loop"></video>
    <p>{{ crate }}</p>
    <i v-if="match">{{ match }}</i>
    <b v-if="self !== undefined">{{ self }}</b>
    <em v-if="static">static</em>
    <u v-if="async">{{ async }}</u>
  </section>
</template>
