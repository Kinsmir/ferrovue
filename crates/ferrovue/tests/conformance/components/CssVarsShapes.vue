<script setup lang="ts">
import CssVarsShow from "./CssVarsShow.vue";
import CssVarsBound from "./CssVarsBound.vue";
import CssVarsTag from "./CssVarsTag.vue";
import CssVarsLink from "./CssVarsLink.vue";
import CssVarsLater from "./CssVarsLater.vue";
import CssVarsBranch from "./CssVarsBranch.vue";

defineProps<{ tone: string; on: boolean }>();
</script>

<template>
  <main>
    <CssVarsShow :tone="tone" :on="on" style="left: 0; --own: 1" />
    <CssVarsBound :tone="tone" style="left: 1px" title="t" />
    <CssVarsTag :tone="tone" :tag="on ? 'section' : 'div'" style="right: 0" />
    <CssVarsLink :tone="tone" style="bottom: 0" />
    <CssVarsLater :tone="tone" style="--later: 1" />
    <CssVarsBranch :tone="tone" :on="on" />
  </main>
</template>
