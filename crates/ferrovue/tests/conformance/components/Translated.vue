<script setup lang="ts">
/* vue-i18n: `$t` in the template and `t` from `useI18n()` in setup, with named and list values,
 * plurals chosen by vue-i18n's rule, literals, linked messages and their modifiers, nested and flat
 * keys, fallback to another locale, and a missing key — and the current locale itself. */
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{ name: string; count: number }>();
const { t, locale } = useI18n();
const title = computed(() => t("greeting", { name: props.name }));
</script>

<template>
  <section :lang="locale" :title="$t('common.app')">
    <h1>{{ title }}</h1>
    <p>{{ $t("apples", count) }}|{{ $t("apples", { count }) }}|{{ $t("items", count) }}|{{ $t("apples") }}|{{ $t("greeting", { name: "x" }, count) }}</p>
    <p>{{ $t("list", [name, count]) }}|{{ $t("literal") }}|{{ $t("linked") }}|{{ $t("missingLink") }}</p>
    <p>{{ $t("onlyEnglish") }}|{{ $t("no.such.key") }}|{{ $t("flat.key") }}|{{ $t("nested.deep.key") }}|{{ t("html", { name }) }}</p>
  </section>
</template>
