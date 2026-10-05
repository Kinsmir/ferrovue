<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import { ClientOnly } from "ferrovue/client";
import StarRating from "../vendor/StarRating";
import Gauge from "../vendor/Gauge";

const LazyNull = defineAsyncComponent(() => import("./NullChild.vue"));

defineProps<{ note: string | null; stars: number | null }>();
</script>

<template>
  <div class="escaped-null">
    <LazyNull :value="note" :entry="null" />
    <ClientOnly>
      <Gauge :level="stars ?? 0" />
      <template #fallback><i :title="note">{{ note ?? "no note" }}</i><b v-if="stars !== null">{{ stars }}</b></template>
    </ClientOnly>
    <StarRating :value="stars ?? 0" :label="note ?? undefined" />
  </div>
</template>
