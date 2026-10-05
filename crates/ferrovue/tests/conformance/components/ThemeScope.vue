<script setup lang="ts">
import { inject, provide } from "vue";
import { ThemeKey } from "../types/keys";

const props = defineProps<{ theme?: string }>();
const outer = inject(ThemeKey, "light");
const mine = props.theme ?? `${outer}-inverse`;
provide(ThemeKey, mine);
provide("tone", "scoped");
</script>

<template>
  <div class="scope" :data-outer="outer"><slot /></div>
</template>
