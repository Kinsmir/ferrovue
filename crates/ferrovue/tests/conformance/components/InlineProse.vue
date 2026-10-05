<script setup lang="ts">
import type { InlineHtml } from "ferrovue/types";

defineProps<{ lead: InlineHtml; note?: InlineHtml; caption: string }>();
</script>

<template>
  <section><p class="lead" v-html="lead"></p><p>Note: <span v-html="note"></span> ({{ caption }})</p></section>
</template>
