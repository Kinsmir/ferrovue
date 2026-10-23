<script setup lang="ts">
export interface Props {
  on1?: number;
  onLabel?: string;
  onShown?: boolean;
  label: string;
}

withDefaults(defineProps<Props>(), { onShown: true });
</script>

<template>
  <b>{{ label }}:{{ on1 ?? -9 }}|{{ onLabel ?? "none" }}|{{ onShown }}</b>
</template>
