<script setup lang="ts">
defineProps<{ note: string; label: string }>();
const text = defineModel<string>({ required: true });
const on = defineModel<boolean>("on", { required: true });
</script>

<template>
  <div class="field">
    <textarea :placeholder="label">{{ note }}</textarea>
    <input v-model="text" :aria-label="label" />
    <input type="checkbox" v-model="on" />
  </div>
</template>
