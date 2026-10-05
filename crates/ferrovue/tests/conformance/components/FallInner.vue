<script setup lang="ts">
defineOptions({ inheritAttrs: false });
defineProps<{ label: string }>();
</script>

<template>
  <div class="wrap">
    <span v-bind="$attrs" id="inner" class="in" :title="label">{{ label }}</span>
    <i id="after" class="later" style="color: red" v-bind="$attrs" />
  </div>
</template>
