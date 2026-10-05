<script setup lang="ts">
import Chips from "./Chips.vue";

interface Score {
  points: number;
  by: string;
}
type Labels = { [key: string]: string };

defineProps<{ counts: Record<string, number>; labels: Labels; scores: Record<string, Score>; groups: Record<string, string[]>; extra?: Record<string, boolean> }>();
</script>

<template>
  <section>
    <ul><li v-for="(count, name, i) in counts" :data-name="name">{{ i }}. {{ name }}: {{ count }}</li></ul>
    <dl><template v-for="(text, key) in labels"><dt>{{ key }}</dt><dd>{{ text }}</dd></template></dl>
    <p v-for="({ points, by }, id) in scores" :id="`s-${id}`">{{ points }} by {{ by }}</p>
    <p v-for="(members, group) in groups">{{ group }}: {{ members.join(", ") }} ({{ members.length }})</p>
    <p>{{ Object.keys(counts).join(",") }}|{{ Object.values(counts).filter((c) => c > 1).length }}|{{ Object.values(labels).join(" ") }}|{{ Object.keys(scores).length }}</p>
    <ol><li v-for="([key, value], i) in Object.entries(counts)">{{ i }}={{ key }}:{{ value }}</li></ol>
    <p>{{ Object.entries(labels).length }}|{{ Object.values(scores).map((s) => s.by).join("/") }}|{{ Object.keys(labels).includes("a") }}</p>
    <template v-if="extra"><i v-for="(on, flag) in extra" :data-on="on">{{ flag }}</i></template>
    <Chips :chips="Object.keys(labels)" :marks="counts" />
  </section>
</template>
