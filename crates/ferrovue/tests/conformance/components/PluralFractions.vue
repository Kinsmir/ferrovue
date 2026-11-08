<script setup lang="ts">
import type { Float } from "ferrovue/types";

defineProps<{ amount: Float; whole: Float; label: string }>();
</script>

<template>
  <p>{{ $t("apples", { count: whole }) }}|{{ $t("items", { n: amount }) }}|{{ $t("fractionLink", { count: amount }) }}|{{ $t("greeting", { name: label, count: amount }) }}</p>
</template>
