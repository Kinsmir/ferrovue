<script setup lang="ts">
/* A store read two ways: through the store, and through `storeToRefs`. */
import { storeToRefs } from "pinia";
import { usePrefs } from "../stores/prefs";

defineProps<{ title: string }>();
const prefs = usePrefs();
const { density, tags } = storeToRefs(prefs);
</script>

<template>
  <span :class="['badge', density]" :data-wide="prefs.wide" @click="prefs.toggle()">{{ title }} {{ prefs.count }}<b v-if="prefs.label">{{ prefs.label }}</b><i v-for="t in tags" :title="t.color">{{ t.name }}</i></span>
</template>
