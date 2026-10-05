<script setup lang="ts">
import { ref } from "vue";
import { ClientOnly } from "ferrovue/client";
import ShareLink from "../vendor/ShareLink";
import StarRating from "../vendor/StarRating";
import type { Review } from "./types";

defineProps<{ reviews: Review[] }>();
const all = ref(false);
</script>

<template>
  <div class="review-list">
    <ol v-if="reviews.length">
      <li v-for="(r, i) in reviews" v-show="all || i < 2" :key="i">
        <StarRating :value="r.stars" />
        <q>{{ r.text }}</q> — {{ r.reader }}
      </li>
    </ol>
    <p v-else>No reviews yet.</p>
    <button v-if="!all && reviews.length > 2" type="button" class="more" @click="all = true">Show all {{ reviews.length }} reviews</button>
    <ClientOnly>
      <ShareLink />
      <template #fallback><span class="share">Share these reviews</span></template>
    </ClientOnly>
  </div>
</template>

<style scoped>
.rating {
  font-variant-numeric: tabular-nums;
  margin-right: 0.5rem;
}
li + li {
  margin-top: 0.25rem;
}
</style>
