<script setup lang="ts">
/* A component whose props are types imported from a shared file: an interface, a list of another,
 * an object type alias, and a union of string literals with a default. */
import type { Badge, Size, User } from "../types/models";

withDefaults(defineProps<{ user: User; size?: Size; badges?: Array<Badge>; note?: string | undefined }>(), { size: "md", badges: () => [] });
</script>

<template>
  <div :class="['card', `card-${size}`]">
    <img v-if="user.avatar" :src="user.avatar" :alt="user.name" />
    <b>{{ user.name }}</b> <small>#{{ user.id }}</small>
    <i v-for="r in user.roles" :class="{ admin: r.admin }">{{ r.name }}</i>
    <span v-for="b in badges" :class="b.tone">{{ b.label }}</span>
    <em v-if="note">{{ note }}</em>
  </div>
</template>
