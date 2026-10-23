<script setup lang="ts">
import type { Float } from "ferrovue/types";
import OnPropsKid from "./OnPropsKid.vue";

defineProps<{ n?: number; text?: string; flag: boolean; rate?: Float; tone?: "" | "warm" | "cold" }>();
</script>

<template>
  <OnPropsKid :on1="n" :on-text="text" :on-flag="flag" :on-set="flag" :on-rate="Math.sqrt(rate ?? 0)" :on-tone="tone" :on-req="flag" :on-num="7" />
</template>
