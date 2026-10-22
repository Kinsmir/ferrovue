<script setup lang="ts">
import { computed } from "vue";

const ROLE: Record<string, string> = { mod: "is-mod", admin: "is-admin", "7": "is-seven" };
const WIDTHS = new Map([
  ["sm", 12],
  ["md", 16],
  ["sm", 14],
]);
const STATUS = new Map<number, string>([
  [404, "missing"],
  [500, "broken"],
]);

const props = defineProps<{ role: string; size: string; code: number; scores: Record<string, number> }>();

const roleClass = computed(() => (Object.hasOwn(ROLE, props.role) ? ROLE[props.role] : "is-member"));
</script>

<template>
  <section :class="Object.hasOwn(ROLE, role) ? ROLE[role] : ''">
    <p>{{ roleClass }}|{{ Object.hasOwn(ROLE, role) }}|{{ !Object.hasOwn(ROLE, role) || ROLE[role] === "is-mod" }}|{{ Object.hasOwn(ROLE, code) }}</p>
    <p>{{ Object.keys(ROLE).join(",") }}|{{ Object.keys(ROLE).includes(role) }}|{{ Object.hasOwn(scores, role) }}</p>
    <p>{{ WIDTHS.get(size) ?? 10 }}|{{ WIDTHS.has(size) }}|{{ WIDTHS.get("md") }}|{{ STATUS.get(code) ?? "fine" }}|{{ STATUS.has(code) }}</p>
    <b v-if="Object.hasOwn(ROLE, role)" :title="role">{{ ROLE[role] }}</b>
    <b v-else>{{ role }}</b>
  </section>
</template>
