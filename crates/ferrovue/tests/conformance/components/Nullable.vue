<script setup lang="ts">
import { computed, ref } from "vue";
import type { Float } from "ferrovue/types";
import type { Entry } from "../types/models";
import NullChild from "./NullChild.vue";

const props = defineProps<{
  label: string | null;
  count: number | null;
  ratio: Float | null;
  on: boolean | null;
  entry: Entry | null;
  entries: Entry[];
  tags: (string | null)[];
}>();
const scaled = computed(() => (props.count !== null ? props.count * 10 : null));
const fallback = computed(() => props.label ?? null);
const picked = ref<string | null>(null);
</script>

<template>
  <section>
    <p>{{ label }}|{{ count }}|{{ ratio }}|{{ on }}|{{ scaled }}|{{ fallback }}</p>
    <p :title="label" :data-count="count" :data-ratio="ratio" :data-on="on" :aria-label="label ?? undefined"></p>
    <input :disabled="on" :value="label" :hidden="count" />
    <p :class="label" :style="{ color: label }">styled</p>
    <p v-if="label !== null">{{ label.length }}:{{ label.toUpperCase() }}</p>
    <p v-if="label === null">no label</p>
    <p v-if="count != null">{{ count * 2 }}</p>
    <p v-if="count == null">no count</p>
    <p v-if="null != ratio">{{ ratio + 1 }}</p>
    <p v-if="label">truthy {{ label }}</p>
    <p v-else>falsy</p>
    <p v-if="scaled !== null && scaled > 20">big</p>
    <p>{{ label ?? "none" }}|{{ count ?? -1 }}|{{ ratio ?? 0.5 }}|{{ on ?? false }}</p>
    <p>{{ label === null }}|{{ count !== null }}|{{ on === true }}|{{ label === "x" }}|{{ null === ratio }}|{{ label == null }}</p>
    <p>{{ entry?.title }}|{{ entry?.deletedAt ?? "live" }}|{{ entry?.score ?? 0 }}|{{ entry?.note }}|{{ entry?.deletedAt == null }}</p>
    <p v-if="entry !== null">{{ entry.title }}{{ entry.deletedAt !== null ? ` (deleted ${entry.deletedAt})` : "" }}</p>
    <ul>
      <li v-for="e in entries" :key="e.title" :data-deleted="e.deletedAt">{{ e.title }}{{ e.deletedAt == null ? "" : "!" }}{{ e.score }}</li>
    </ul>
    <ul>
      <li v-for="(t, i) in tags" :key="i" :title="t">{{ t ?? "-" }}{{ t === null ? "?" : "" }}</li>
    </ul>
    <p>{{ count !== null ? count : null }}|{{ label ? label : null }}|{{ on ? null : "off" }}</p>
    <p :title="picked">{{ picked ?? "unpicked" }}|{{ picked === null }}|{{ picked?.length }}</p>
    <NullChild :value="label" :entry="entry" v-slot="{ v, e }">{{ v === null ? "slot:null" : `slot:${v}` }}{{ e?.deletedAt ?? "" }}</NullChild>
    <NullChild :value="null" :entry="null" />
    <NullChild :value="entry?.deletedAt ?? null" :entry="entries.find((e) => e.deletedAt === null) ?? null" />
  </section>
</template>
