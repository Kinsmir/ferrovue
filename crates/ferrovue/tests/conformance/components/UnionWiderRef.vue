<script setup lang="ts">
import { ref } from "vue";
import UnionBadge from "./UnionBadge.vue";
import UnionMark from "./UnionMark.vue";
import { Mark } from "../types/marks";
import type { Mood } from "../types/tables";

const props = defineProps<{ mark: Mark; spare?: Mark; mood: Mood; on: boolean; label: string }>();
const held = ref<Mark | "">(props.mark);
const picked = ref<Mark | "">(props.on ? props.mark : "");
const spared = ref<Mark | "" | undefined>(props.spare);
const kept = ref<Mood | "">(props.mood);
const chosen = ref<Mood | "" | undefined>(props.on ? props.mood : "");
</script>

<template>
  <section :title="label">
    <p :class="{ none: picked === '', bang: held === Mark.Bang }" :data-held="held">{{ held }} {{ picked }} {{ `${picked}|${spared}` }}</p>
    <i v-if="spared === ''">empty</i>
    <i v-else-if="spared === undefined">absent</i>
    <UnionMark v-else :mark="spared" :label="label" />
    <UnionMark v-if="picked !== ''" :mark="picked" :label="label" />
    <UnionMark :mark="held || undefined" :label="`${held}!`" />
    <UnionBadge v-if="kept !== ''" :mood="kept" :label="label" />
    <UnionBadge :mood="chosen || undefined" :label="`${chosen}`" />
    <b :class="{ none: chosen === '', calm: kept === 'calm' }">{{ kept }} {{ chosen }}</b>
  </section>
</template>
