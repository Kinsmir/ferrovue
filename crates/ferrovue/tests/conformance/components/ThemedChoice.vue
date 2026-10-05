<script setup lang="ts">
import { computed, provide } from "vue";
import ThemeScope from "./ThemeScope.vue";
import ThemedButton from "./ThemedButton.vue";
import TagHeading from "./TagHeading.vue";
import { ThemeKey } from "../types/keys";

const props = defineProps<{ kind: "scope" | "button"; tag: "div" | "aside"; label: string; theme: string }>();
provide(ThemeKey, props.theme);
const chosen = computed(() => (props.kind === "scope" ? ThemeScope : ThemedButton));
</script>

<template>
  <section>
    <component :is="chosen" :label="label"><ThemedButton :label="`${label} in scope`" /></component>
    <component :is="kind === 'scope' ? ThemeScope : 'p'" theme="dark"><ThemedButton label="slotted" /></component>
    <component :is="tag" class="frame"><ThemedButton :label="label" /><ThemeScope><ThemedButton label="deep" /></ThemeScope></component>
    <TagHeading as="h3" :text="label"><ThemedButton label="heading" /></TagHeading>
  </section>
</template>
