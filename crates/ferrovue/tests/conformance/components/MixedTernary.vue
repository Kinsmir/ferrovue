<script setup lang="ts">
import type { Float } from "ferrovue/types";

defineProps<{ count: number; price: Float; on: boolean; spare?: number; label: string; tags: string[]; ratio: Float | null }>();
</script>

<template>
  <section :title="count > 0 ? count : 'none'" :data-price="on ? price : label">
    <p>{{ count > 0 ? count : "none" }} {{ on ? true : "off" }} {{ spare ? spare : "zero" }}</p>
    <p>{{ on ? (count > 1 ? price : false) : label }} {{ on ? spare : "absent" }} {{ ratio !== null ? ratio : "no ratio" }}</p>
    <p>{{ `${on ? count : "-"}|${spare !== undefined ? spare : "?"}|${on ? tags : price}|${on ? ratio : false}` }}</p>
    <b :aria-label="spare === undefined ? 'unset' : spare" :data-on="on ? 1 : on">{{ count < 0 ? count : on }}</b>
  </section>
</template>
