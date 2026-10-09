<script lang="ts">
export interface Item {
  id: number;
  name: string;
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from "vue";

defineOptions({ name: "Lifecycle" });
const props = defineProps<{ items: Item[]; query: string }>();
const emit = defineEmits<{ pick: [id: number] }>();
defineSlots<{ default?(): unknown }>();

interface Panel {
  title: string;
  anchor: HTMLElement;
  open(): void;
}

const MAX = 3;
const prefix = "#";
const el = ref<HTMLElement | null>(null);
const list = useTemplateRef<HTMLUListElement>("list");
const mounted = ref(false);
const shown = ref(props.query.trim());
const total = computed(() => {
  return props.items.length;
});
const panels = shallowRef<Panel[]>([]);
let timer: number | undefined;

watch(() => props.query, (q) => (shown.value = q));
onMounted(() => {
  mounted.value = true;
  timer = 1;
});
onBeforeUnmount(() => clearTimeout(timer));
function pick(id: number) {
  emit("pick", id);
}
defineExpose({ el, list });
</script>

<template>
  <section ref="el" :data-mounted="mounted">
    <p>{{ shown }} ({{ total }} of max {{ MAX }})</p>
    <p v-if="panels.length"><b v-for="panel in panels">{{ panel.title }}</b></p>
    <ul ref="list"><li v-for="item in items" @click="pick(item.id)">{{ prefix }}{{ item.id }} {{ item.name }}</li></ul>
  </section>
</template>
