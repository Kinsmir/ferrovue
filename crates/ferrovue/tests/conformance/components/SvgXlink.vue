<script setup lang="ts">
defineProps<{ href: string; id: string; title?: string }>();
</script>

<template>
  <div>
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">
      <defs><circle id="dot" r="1" /></defs>
      <use xlink:href="#dot" />
      <use :xlink:href="'#' + id" />
      <a :xlink:href="href" :xlink:title="title"><text>{{ href }}</text></a>
      <image :xlink:href="href" width="1" height="1" />
    </svg>
  </div>
</template>
