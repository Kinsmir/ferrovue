<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";

interface Item {
  id: string;
  children: Props[];
  tags?: string[];
}

export interface Props {
  label: string;
  flag: boolean;
  others: Props[];
  item?: Item;
}

const props = defineProps<Props>();

const seeded = shallowRef(props.item ? props.item.children : []);
const none: Props[] = [];
const fromConst = shallowRef(props.item ? props.item.children : none);
const stated = shallowRef(props.item ? props.item.children : ([] as Props[]));
const typed = ref<Props[]>(props.flag ? props.others : []);
const flipped = computed(() => (props.item ? [] : props.others));
const chained = computed(() => props.item?.children ?? []);
const tags = computed(() => props.item?.tags ?? []);
const nested = computed(() => (props.flag ? props.others : props.item ? props.item.children : []));
const labels = computed(() => (props.flag ? props.others.map((o) => o.label) : []));
</script>

<template>
  <section>
    <h2>{{ label }}</h2>
    <ul>
      <li v-for="x in seeded">{{ x.item?.id }}|{{ x.label }}</li>
    </ul>
    <ol>
      <li v-for="x in fromConst">{{ x.label }}</li>
    </ol>
    <ol>
      <li v-for="(x, i) in stated">{{ i }}:{{ x.label }}</li>
    </ol>
    <p v-for="x in typed">{{ x.label }}</p>
    <p v-for="x in flipped">{{ x.label }}</p>
    <p v-for="x in chained">{{ x.item?.id ?? "none" }}</p>
    <p v-for="t in tags">{{ t }}</p>
    <p v-for="x in nested">{{ x.label }}</p>
    <p>{{ labels.join("/") }} {{ seeded.length }} {{ none.length }}</p>
    <i v-for="x in (item ? item.children : [])">{{ x.label }}</i>
    <i v-for="x in (flag ? none : others)">{{ x.label }}</i>
    <b v-for="t in (flag ? ['x', label] : [])">{{ t }}</b>
    <u v-for="x in (false ? others : [])">{{ x.label }}</u>
    <s>{{ (item ? item.children : []).length }} {{ (item?.tags ?? []).join(",") }} {{ (item?.children ?? others).length }}</s>
  </section>
</template>
