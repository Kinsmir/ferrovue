<script setup lang="ts">
import StarRating from "../vendor/StarRating";

defineProps<{ title: string; stars: number; votes?: number; label?: string }>();
</script>

<template>
  <article class="rated">
    <h3>{{ title }}</h3>
    <StarRating :value="stars" :max="5" :label="label" class="compact" :data-title="title">
      <small v-if="votes">{{ votes }} votes</small>
    </StarRating>
    <StarRating :value="0" readonly />
  </article>
</template>
