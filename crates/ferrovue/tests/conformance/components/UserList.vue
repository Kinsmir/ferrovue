<script setup lang="ts">
import UserCard from "./UserCard.vue";
import Lifecycle from "./Lifecycle.vue";
import type { User } from "../types/models";
import type { Item } from "./Lifecycle.vue";

defineProps<{ users: User[]; featured?: User; items: Item[] }>();
</script>

<template>
  <section>
    <UserCard v-if="featured" :user="featured" size="lg" :badges="[]" note="featured" />
    <UserCard v-for="u in users" :user="u" :size="u.size" />
    <Lifecycle :items="items" query="all" />
  </section>
</template>
