<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{ cents: number; total: string; posted: string }>();
const { t, locale } = useI18n();
const fixed = computed(() => (props.cents / 100).toFixed(2));
const amount = computed(() => (locale.value === "nl" ? fixed.value.replace(".", ",") : fixed.value));
</script>

<template>
  <section :lang="locale">
    <p>{{ t("price", { amount }) }}</p>
    <p>{{ total }}</p>
    <p>{{ $t("posted", { date: new Date(posted).toISOString().slice(0, 10) }) }}</p>
    <time :datetime="new Date(posted).toISOString()">{{ new Date(posted).getUTCDate() }}-{{ new Date(posted).getUTCMonth() + 1 }}-{{ new Date(posted).getUTCFullYear() }}</time>
  </section>
</template>
