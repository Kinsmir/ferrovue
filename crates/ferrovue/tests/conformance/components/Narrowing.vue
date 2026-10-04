<script setup lang="ts">
/* Optional values narrowed as TypeScript narrows them: by truthiness, by `!== undefined`, and by
 * their negations, which narrow the other branch — in `v-if`, `?:`, `&&` and `||`. */
import type { Float } from "ferrovue/types";
import type { User } from "../types/models";

defineProps<{ label?: string; count?: number; ratio?: Float; on?: boolean; user?: User }>();
</script>

<template>
  <section>
    <p v-if="label !== undefined">{{ label.length }}:{{ label.toUpperCase() }}</p>
    <p v-if="count !== undefined">{{ count * 2 }}|{{ count + 1 }}|{{ count % 3 }}|{{ `#${count}` }}</p>
    <p v-if="label === undefined">no label</p>
    <p v-else>{{ label.trim() || "blank" }}</p>
    <p v-if="!user">no user</p>
    <p v-else>{{ user.name }}{{ user.avatar !== undefined ? ` (${user.avatar.length})` : "" }}</p>
    <p v-if="ratio !== undefined && ratio > 0.5">{{ Math.round(ratio * 10) }}</p>
    <p v-if="user !== undefined && user.avatar !== undefined">{{ user.avatar.trim() }}</p>
    <p>{{ count !== undefined ? count / 4 : -1 }}|{{ count === undefined ? "none" : String(count - 1) }}</p>
    <p>{{ label ? label.length : 0 }}|{{ !label ? "empty" : label }}</p>
    <p>{{ label !== undefined && label.length > 2 }}|{{ label === undefined || label.length === 0 }}|{{ !count || count > 3 }}</p>
    <p>{{ ratio ?? 0 }}|{{ (count ?? 0.5) * 2 }}|{{ on !== undefined ? on : "unset" }}</p>
    <p :title="label !== undefined ? label + '!' : undefined" :data-n="count !== undefined ? count : undefined"></p>
    <p v-if="label && label === undefined">never</p>
    <p v-if="label !== undefined || count !== undefined">some</p>
  </section>
</template>
