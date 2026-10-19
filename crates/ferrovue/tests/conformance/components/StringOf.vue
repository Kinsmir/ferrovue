<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";

const props = defineProps<{
  label?: string;
  count?: number;
  ratio?: Float;
  on?: boolean;
  nick: string | null;
  score: number | null;
  tags: string[];
  nums: number[];
  fracs: Float[];
  flags: boolean[];
  names: (string | null)[];
  marks: (number | null)[];
}>();
const line = computed(() => `${props.label}/${props.count}/${props.nick}/${props.tags}`);
const kept = computed(() => String(props.tags.filter((t) => t.length > 1)));
</script>

<template>
  <section :title="`${label}`" :data-n="String(count)">
    <p>{{ `${label}` }}|{{ String(label) }}|{{ `${count}` }}|{{ String(ratio) }}|{{ `${on}` }}|{{ String(nick) }}|{{ `${score}` }}</p>
    <p>{{ label }}|{{ count }}|{{ nick }}|{{ String(undefined) }}|{{ `${null}` }}|{{ `[${undefined}]` }}</p>
    <p>{{ `${tags}` }}|{{ String(nums) }}|{{ `${fracs}` }}|{{ String(flags) }}|{{ `${names}` }}|{{ String(marks) }}|{{ String([]) }}</p>
    <p>{{ `${tags.map((t) => t.toUpperCase())}` }}|{{ String(nums.map((n) => n / 2)) }}|{{ `(${tags.slice(1)})` }}|{{ kept }}|{{ line }}</p>
    <p>{{ "<".concat(label ?? "", ">", String(count)) }}|{{ (nick ?? "-").concat(String(score), `${on}`) }}|{{ `${label ?? "none"}` }}|{{ `${tags.join("+")}` }}</p>
  </section>
</template>
