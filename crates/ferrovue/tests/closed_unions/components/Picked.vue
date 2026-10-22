<script setup lang="ts">
import Plain from "./Plain.vue";
import Strong from "./Strong.vue";

type K = "a" | "b" | "c";
defineProps<{ k: K; tag: "b" | "i" | "u" }>();
const PICK = { a: Plain, b: Strong, c: Plain } as const;
const PICK_TAG = { a: "em", b: "strong", c: "em" } as const;
</script>

<template>
  <div>
    <component :is="PICK[k]" /><component :is="PICK_TAG[k]">t</component><component :is="tag">u</component>
  </div>
</template>
