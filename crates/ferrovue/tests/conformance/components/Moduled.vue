<script setup lang="ts">
import { computed, useCssModule } from "vue";
import ModuledChip from "./ModuledChip.vue";

const props = defineProps<{ text: string; on: boolean; tone?: string }>();
const theme = useCssModule("theme");
const picked = computed(() => (props.on ? theme.big : theme.small));
</script>

<template>
  <section :class="$style.card">
    <h2 :class="[$style.title, { [$style.active]: on }]">{{ text }}</h2>
    <p :class="$style['red-dash']" :data-anim="$style.spin">{{ tone ?? $style.primary }}</p>
    <p :class="[picked, $style.missing, $style['sm:hidden']]">{{ $style.comp }}</p>
    <span :class="theme.big" class="plain">{{ theme.small }}</span>
    <i :class="mark.dot" />
    <ModuledChip :class="$style.boxed" :label="text" />
  </section>
</template>

<style module>
@value primary: #f00;
.card { padding: 1rem; }
.title, .active:hover { color: primary; }
.red-dash { color: red; }
:global(.outside) .inside { margin: 0; }
.comp { composes: title active; font-weight: bold; }
@keyframes spin { from { opacity: 0; } }
.sm\:hidden { display: none; }
.boxed { border: 1px solid; }
</style>

<style module="theme">
.big { font-size: 2em; }
.small { font-size: 0.5em; }
</style>

<style module="mark" scoped>
.dot { color: v-bind(tone); }
</style>
