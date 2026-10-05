<script setup lang="ts">
import Nav from "./Nav.vue";
import type { Props as NavProps } from "./Nav.vue";

defineProps<{ nav: NavProps }>();
</script>

<template>
  <div id="app"><Nav v-bind="nav" /><main><RouterView /></main></div>
</template>
