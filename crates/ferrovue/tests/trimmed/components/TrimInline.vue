<script setup lang="ts">
import TrimButton from "./TrimButton.vue";

defineProps<{ label: string; name: string }>();
</script>

<template>
  <p>
    <span> by </span><a>{{ name }}</a>
    <span>signed in through </span>{{ label }}
    <span> · </span>
    <b>
      {{ label }} and </b>
    <i> to {{ name }}
    </i>
    <em>&#10;to {{ label }} by&#10;</em>
    <TrimButton kind="inline"> to {{ label }} </TrimButton>
  </p>
</template>
