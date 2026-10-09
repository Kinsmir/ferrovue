<script setup lang="ts">
import Listened from "./Listened.vue";
import type { Props as RowProps } from "./Listened.vue";
import ListenLeaf from "./ListenLeaf.vue";
import type { Props as LeafProps } from "./ListenLeaf.vue";
import ListenSale from "./ListenSale.vue";

defineProps<{ title: string; event: string; leaves: LeafProps[]; tree: RowProps }>();
const seen: string[] = [];
function note(what: unknown) {
  seen.push(String(what));
}
const handlers = { picked: note, mouseenter: note, Hover: note };
</script>

<template>
  <section>
    <ListenLeaf :label="title" @picked="note" @click="note('click')" v-on:focus.once="note" @update:label="note" />
    <ListenLeaf :label="title" title="tip" @click.stop="note" @[event]="note" />
    <ListenLeaf v-for="l in leaves" :key="l.label" v-bind="l" @picked="note" @mouseenter="note" />
    <ListenLeaf v-for="l in leaves" v-bind="l" v-on="handlers" />
    <ListenLeaf v-for="l in leaves" v-bind="l" @[event]="note" />
    <ListenLeaf v-for="l in leaves" v-bind="l" @update:label="(v) => note(v)" v-on:picked.once="note" />
    <ListenSale :label="title" />
    <ListenSale :label="title" :on-sale="true" @picked="note" />
    <Listened v-bind="tree" @loaded="note('tree')" />
    <Listened :id="title" :label="title" :rows="[]" @loaded="(rows) => note(rows.length)" />
  </section>
</template>
