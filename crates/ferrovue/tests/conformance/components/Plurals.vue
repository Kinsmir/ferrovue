<script setup lang="ts">
/* vue-i18n's plural choice and its `count` and `n`: a fractional number choosing the case, a value
 * that is not a finite number passed over for the plural number, `count` given falsy taking the
 * plural number and given truthy keeping its own, and the `lower` modifier. */
import type { Float } from "ferrovue/types";

defineProps<{ count: number; amount: Float; label: string; on: boolean }>();
</script>

<template>
  <p>{{ $t("items", { n: amount }) }}|{{ $t("apples", { count: amount + 1 }) }}|{{ $t("apples", { count: amount / (count - count) }) }}|{{ $t("apples", { count: amount / (count - count) }, 5) }}</p>
  <p>{{ $t("apples", { count: label }, count) }}|{{ $t("apples", { count: on }, count) }}|{{ $t("apples", { count: amount * 2 }, count) }}|{{ $t("apples", { count: 0 }, count) }}|{{ $t("apples", { count: 7 }, count) }}|{{ $t("apples", { count: 0, other: 5 }) }}</p>
  <p>{{ $t("shout") }}</p>
</template>
