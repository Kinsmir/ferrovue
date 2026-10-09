<script setup lang="ts">
import UnsanitisedLeaf from "./UnsanitisedLeaf.vue";

defineProps<{ url: string; doc: string; handler: string; color: string; css: string }>();
</script>

<template>
  <section>
    <a :href="url">link</a>
    <img :src="url" alt="" />
    <iframe :srcdoc="doc"></iframe>
    <button :onclick="handler" :formaction="url">go</button>
    <p :style="{ color }">a</p>
    <p :style="css">b</p>
    <UnsanitisedLeaf :onclick="handler" :style="css" :srcdoc="doc" />
  </section>
</template>
