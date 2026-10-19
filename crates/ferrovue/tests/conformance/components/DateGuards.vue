<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ at: Date; edited?: Date; deleted: Date | null; fallback: Date; stamp: string; title: string }>();
const valid = computed(() => !Number.isNaN(props.at.getTime()));
const shown = computed(() => props.edited || props.at);
const either = computed(() => props.deleted || props.edited);
const parsed = computed(() => new Date(props.stamp));
const iso = computed(() => parsed.value.toISOString());
</script>

<template>
  <article :title="title">
    <h2>{{ title }}</h2>
    <p v-if="!Number.isNaN(at.getTime())"><time :datetime="at.toISOString()">{{ at.getUTCFullYear() }}</time></p>
    <p v-else>invalid {{ at.getTime() }}</p>
    <p v-if="valid">{{ Number.isFinite(at.getTime()) }}|{{ Number.isInteger(at.getTime()) }}|{{ Number.isSafeInteger(at.valueOf()) }}</p>
    <p v-else>{{ Number.isFinite(at.getTime()) }}|{{ Number.isNaN(at.getUTCDate()) }}</p>
    <p :data-valid="Number.isFinite(parsed.getTime())">{{ (edited || at).getTime() }}|{{ shown.getTime() }}|{{ (deleted || fallback).getTime() }}|{{ (at || fallback).getTime() }}|{{ (deleted || edited || at).getUTCDate() }}</p>
    <p v-if="either">{{ either.getTime() }}</p>
    <p v-if="deleted || edited">{{ (deleted || edited || fallback).getUTCHours() }}</p>
    <p v-if="edited && !Number.isNaN(edited.getTime())">{{ (edited || fallback).toISOString() }}</p>
    <p>{{ (edited ?? fallback).getTime() }}|{{ (edited ? edited : fallback).getTime() }}|{{ (deleted !== null ? deleted : at).getTime() }}|{{ (deleted ?? edited ?? fallback).getTime() }}</p>
    <p v-if="Number.isNaN(parsed.getTime())">bad stamp</p>
    <p v-else>{{ iso }}</p>
  </article>
</template>
