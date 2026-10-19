<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";

interface Owner {
  name: string;
}

const props = defineProps<{ label?: string; nick: string | null; count: number; ratio: Float; on: boolean; tags: string[]; owner?: Owner; size?: number }>();
const kind = computed(() => typeof props.label);
const sized = computed(() => (typeof props.size === "number" ? props.size * 2 : -1));
</script>

<template>
  <section :data-kind="typeof label" :class="{ named: typeof label === 'string' }">
    <p>{{ typeof label }}|{{ typeof nick }}|{{ typeof count }}|{{ typeof ratio }}|{{ typeof on }}|{{ typeof tags }}|{{ typeof owner }}|{{ kind }}|{{ sized }}</p>
    <p>{{ typeof label === "string" }}|{{ typeof label !== "undefined" }}|{{ typeof label == "undefined" }}|{{ typeof nick === "object" }}|{{ typeof nick === "string" }}|{{ typeof count === "number" }}|{{ typeof tags === "object" }}|{{ typeof on !== "boolean" }}</p>
    <p>{{ typeof owner === "object" }}|{{ typeof owner === "undefined" }}|{{ "number" === typeof size }}|{{ typeof count === "string" }}|{{ typeof label === typeof nick }}</p>
    <p v-if="typeof label === 'string'">{{ label.length }}:{{ label.toUpperCase() }}</p>
    <p v-else>no label</p>
    <p v-if="typeof owner !== 'undefined'">{{ owner.name }}</p>
    <i v-if="typeof nick === 'string' && nick.length > 2">{{ nick }}</i>
    <b>{{ typeof size === "undefined" ? -1 : size + 1 }}</b>
  </section>
</template>
