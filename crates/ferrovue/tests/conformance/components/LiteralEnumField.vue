<script setup lang="ts">
interface Row {
  text: string;
  kind: "plain" | "loud";
  mood?: "calm" | "wild";
}

const props = defineProps<{ text: string; loud: boolean; mood?: "calm" | "wild" }>();

function row(): Row {
  return { text: props.text, kind: props.loud ? "loud" : "plain", mood: props.mood };
}
</script>

<template>
  <p :data-kind="row().kind" :title="row().text">{{ row().text }}|{{ row().kind }}|{{ row().kind === "loud" }}|{{ row().kind !== "plain" }}|{{ row().mood ?? "none" }}|{{ row().mood === "wild" }}</p>
  <b v-if="row().kind === 'loud'">{{ row().text.toUpperCase() }}</b>
</template>
