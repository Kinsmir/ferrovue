<script setup lang="ts">
import type { TrustedHtml } from "ferrovue/types";
defineProps<{ reader: string; body: TrustedHtml }>();
</script>

<template>
  <figure class="review"><blockquote v-html="body"></blockquote><figcaption>{{ reader }}</figcaption></figure>
</template>
