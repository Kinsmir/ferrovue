<script setup lang="ts">
import type { Float } from "ferrovue/types";

withDefaults(
  defineProps<{
    on1?: number;
    onText?: string;
    onFlag?: boolean;
    onSet?: boolean;
    onRate?: Float;
    onTone?: "" | "warm" | "cold";
    onReq: boolean;
    onNum: number;
  }>(),
  { on1: 4, onSet: true },
);
</script>

<template>
  <i>{{ on1 }}|{{ onText ?? "none" }}|{{ onFlag }}|{{ onSet }}|{{ onRate }}|{{ onTone ?? "unset" }}|{{ onReq }}|{{ onNum }}</i>
</template>
