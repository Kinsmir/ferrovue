<script setup lang="ts">
import { computed, provide } from "vue";
import Tab from "./Tab.vue";
import Tabs from "./Tabs.vue";
import ThemedButton from "./ThemedButton.vue";
import ThemeScope from "./ThemeScope.vue";
import { AccentKey, ThemeKey } from "../types/keys";

const props = defineProps<{ theme: string; size: number; active: string; inner: string; names: string[] }>();
provide(ThemeKey, props.theme);
provide("size", props.size);
provide(AccentKey, computed(() => props.theme.toUpperCase()));
</script>

<template>
  <main>
    <ThemedButton label="direct" />
    <Tabs :active="active" :count="names.length" title="outer">
      <Tab v-for="n in names" :key="n" :name="n" :title="n" />
      <ThemedButton label="in a slot" />
      <Tabs :active="inner" :count="1" title="inner">
        <Tab :name="inner" title="nearer" />
      </Tabs>
    </Tabs>
    <ThemeScope theme="dark"><ThemedButton label="shadowed" /></ThemeScope>
    <ThemeScope><ThemedButton label="derived" /></ThemeScope>
    <Tab name="alone" title="no tabs" />
  </main>
</template>
