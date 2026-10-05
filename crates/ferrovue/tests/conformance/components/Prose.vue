<script setup lang="ts">
import type { TrustedHtml } from "ferrovue/types";

defineProps<{ body: TrustedHtml; aside?: TrustedHtml; caption: string }>();
</script>

<template>
  <article><div class="body" v-html="body"></div><aside v-html="aside"></aside><p>{{ caption }}</p></article>
</template>
