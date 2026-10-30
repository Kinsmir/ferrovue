<script setup lang="ts">
import type { InlineHtml, TrustedHtml } from "ferrovue/types";

defineProps<{ content?: TrustedHtml; body: TrustedHtml; note?: InlineHtml; lead: InlineHtml }>();
</script>

<template>
  <section>
    <div v-if="content" class="content" v-html="content"></div>
    <p v-else>no content</p>
    <div v-if="body" class="body" v-html="body"></div>
    <p v-else>no body</p>
    <b v-if="!content">not content</b>
    <b v-if="!body">not body</b>
    <span>{{ content ? "content" : "none" }} {{ body ? "body" : "none" }} {{ note ? "note" : "none" }} {{ lead ? "lead" : "none" }}</span>
    <p v-if="note" class="note" v-html="note"></p>
    <p v-else-if="lead" class="lead" v-html="lead"></p>
    <p v-else>neither</p>
    <em v-show="note">shown</em>
    <s v-if="!lead">no lead</s>
    <u v-if="content && body">both</u>
    <u v-if="note || lead">either</u>
  </section>
</template>
