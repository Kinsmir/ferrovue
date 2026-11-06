<script setup lang="ts">
import TrimButton from "./TrimButton.vue";

defineProps<{ label: string; on: boolean }>();
</script>

<template>
  <div>
    <TrimButton kind="a">
      remove {{ label }}
    </TrimButton>
    <TrimButton kind="b" />
    <TrimButton kind="c">
      <template #default>
        named {{ label }}
      </template>
      <template #after="{ kind }">
        after {{ kind }}
      </template>
    </TrimButton>
    <TrimButton v-if="on" kind="d">
      <b>{{ label }}</b>
      text
    </TrimButton>
  </div>
</template>
