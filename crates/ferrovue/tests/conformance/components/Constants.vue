<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{ label: string; note?: string; count: number; tags: string[] }>();
const picked = ref(props.label);
const status = ref("");
const mood = ref(`calm & <quiet> "x" 'y'`);
const echo = computed(() => status.value);
const blank = computed(() => mood.value === "");
const unlabelled = computed(() => props.label === "");
const prefixed = computed(() => `${props.label}!` === "");
const greeting = `hi ${mood.value}`;
const limit = ref(0);
</script>

<template>
  <section>
    <p v-if="status">{{ status }}</p>
    <p v-else>no status</p>
    <p v-if="!status">still none</p>
    <p v-if="mood">{{ mood }}</p>
    <p v-if="echo">{{ echo }}</p>
    <p v-else>no echo</p>
    <p v-if="blank">blank</p>
    <p v-if="status === ''">status empty</p>
    <p v-if="mood !== ''">mood set</p>
    <p v-if="label !== ''">{{ label }}</p>
    <p v-if="unlabelled">unlabelled</p>
    <p v-if="prefixed">never</p>
    <p v-if="`${label}` === ''">label empty</p>
    <p v-if="`${status}` !== ''">never</p>
    <p v-if="(note ?? '') === ''">no note</p>
    <p v-if="label + status === ''">still empty</p>
    <p :title="status || mood">{{ greeting }}</p>
    <p v-if="note === ''">note empty</p>
    <p v-if="label.trim() !== ''">trimmed</p>
    <p v-if="label === status">label is status</p>
    <p v-if="label.slice(1) === `${status}`">tail empty</p>
    <p v-if="tags.includes('')">a blank tag</p>
    <p v-if="['', 'x'].includes(label)">blank or x</p>
    <select v-model="status"><option value="">none</option><option value="a">a</option></select>
    <select v-model="picked"><option value="">none</option><option :value="mood">mood</option></select>
    <input type="radio" v-model="status" value="" />
    <input type="radio" v-model="picked" value="" />
    <p v-if="limit">{{ limit }}</p>
    <p v-if="count > limit">{{ count }}</p>
  </section>
</template>
