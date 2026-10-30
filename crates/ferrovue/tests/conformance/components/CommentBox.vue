<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<template>
  <!-- the box -->
  <div class="box"><!-- <b>&amp; "q' \ --><slot><!-- no content -->{{ label }}</slot></div>
</template>
