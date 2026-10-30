<script setup lang="ts">
type Side = "none" | "left" | "right";

defineProps<{
  side: Side;
  labels: { left: string; right: string };
}>();
</script>

<template>
  <p :title="side !== 'none' ? labels[side] : 'none'">{{ side !== "none" ? labels[side] : "none" }}|{{ side === "none" ? "-" : labels[side] }}</p>
</template>
