<script setup lang="ts">
defineProps<{ on: boolean; mode: string; maybe: string | null; spell?: string }>();
</script>

<template>
  <section>
    <div :contenteditable="on" :spellcheck="on" :draggable="on">booleans</div>
    <div :contenteditable="!on" :spellcheck="!on" :draggable="!on">negated</div>
    <div :contenteditable="mode" :spellcheck="mode" :draggable="mode">strings</div>
    <div :contenteditable="maybe" :spellcheck="maybe" :draggable="maybe">nullable</div>
    <div :spellcheck="spell" :draggable="spell">optional</div>
    <div :contenteditable="null" :spellcheck="undefined" draggable>absent</div>
    <div :contenteditable="true" :spellcheck="false" :draggable="''">literals</div>
    <div contenteditable="plaintext-only" spellcheck="" draggable="false">static</div>
  </section>
</template>
