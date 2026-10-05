<script setup lang="ts">
import type { Float } from "ferrovue/types";

defineProps<{ count: number; amount: Float; label: string; on: boolean }>();
</script>

<template>
  <p>{{ $t("items", { n: amount }) }}|{{ $t("apples", { count: amount + 1 }) }}|{{ $t("apples", { count: amount / 0 }) }}|{{ $t("apples", { count: amount / 0 }, 5) }}</p>
  <p>{{ $t("apples", { count: label }, count) }}|{{ $t("apples", { count: on }, count) }}|{{ $t("apples", { count: amount * 2 }, count) }}|{{ $t("apples", { count: 0 }, count) }}|{{ $t("apples", { count: 7 }, count) }}|{{ $t("apples", { count: 0, other: 5 }) }}</p>
  <p>{{ $t("shout") }}</p>
</template>
