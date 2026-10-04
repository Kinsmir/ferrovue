<script setup lang="ts">
/* A parent of everything: props handed to children as literals, as variables, as lists and as a
 * whole `Props`; slot content holding components, loops and conditions. */
import Panel from "./Panel.vue";
import type { Props as PanelProps } from "./Panel.vue";
import Text from "./Text.vue";
import Frame from "./Frame.vue";

defineProps<{ heading: string; panels: PanelProps[]; words: string[]; footer?: string; total: number }>();
</script>

<template>
  <main>
    <Panel :title="heading" :count="total">
      <template #title><h1>{{ heading }}</h1></template>
      <Text :title="heading" :count="total" :on="total !== 0" padded=" x " />
      <template #footer><span v-if="footer">{{ footer }}</span></template>
    </Panel>
    <Panel v-for="p in panels" v-bind="p">
      <Frame :title="heading"><i v-for="w in words">{{ w }}</i></Frame>
    </Panel>
    <Panel title="static"><template v-if="words.length"><b v-for="w in words">{{ w }}</b></template></Panel>
  </main>
</template>
