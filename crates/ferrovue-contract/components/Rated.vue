<script setup lang="ts">
import StarRating from "../vendor/StarRating";

defineProps<{ stars: number }>();
</script>

<template>
  <StarRating :value="stars" :max="5"><small>votes</small></StarRating>
</template>
