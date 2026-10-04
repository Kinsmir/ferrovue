<script setup lang="ts">
/* A book's reviews: the slow part of the detail page, which the server streams after the rest, as
 * an island. The first two show at once; the client makes the button reveal the others. */
import { ref } from "vue";
import type { Review } from "./types";

defineProps<{ reviews: Review[] }>();
const all = ref(false);
</script>

<template>
  <div class="review-list">
    <ol v-if="reviews.length">
      <li v-for="(r, i) in reviews" v-show="all || i < 2" :key="i">
        <span class="stars" :aria-label="`${r.stars} out of 5`">{{ r.stars }}/5</span>
        <q>{{ r.text }}</q> — {{ r.reader }}
      </li>
    </ol>
    <p v-else>No reviews yet.</p>
    <button v-if="!all && reviews.length > 2" type="button" class="more" @click="all = true">Show all {{ reviews.length }} reviews</button>
  </div>
</template>
