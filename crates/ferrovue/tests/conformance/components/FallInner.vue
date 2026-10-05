<script setup lang="ts">
/* `inheritAttrs: false`: nothing reaches the root, and `v-bind="$attrs"` puts the attributes on
 * inner elements instead — before the element's own, which then win, and after them, which lose. */
defineOptions({ inheritAttrs: false });
defineProps<{ label: string }>();
</script>

<template>
  <div class="wrap">
    <span v-bind="$attrs" id="inner" class="in" :title="label">{{ label }}</span>
    <i id="after" class="later" style="color: red" v-bind="$attrs" />
  </div>
</template>
