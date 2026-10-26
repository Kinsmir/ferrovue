<script setup lang="ts">
import RootCheckbox from "./RootCheckbox.vue";
import RootInput from "./RootInput.vue";
import RootTextarea from "./RootTextarea.vue";
import RootTextareaText from "./RootTextareaText.vue";

defineProps<{ label: string; on: boolean }>();
</script>

<template>
  <form :title="label">
    <RootTextarea :model-value="label" class="big" :placeholder="label" />
    <RootTextareaText :id="`t-${label}`" />
    <RootInput :model-value="label" :name="label" :disabled="!on" />
    <RootCheckbox :model-value="on" name="agree" :class="{ on }" />
    <RootInput model-value="" />
  </form>
</template>
