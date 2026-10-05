<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useSession } from "../stores/session";

const session = useSession();
const { user, visits } = storeToRefs(session);
</script>

<template>
  <div :data-user="user" :data-visits="visits" @click="session.signOut()">
    <p v-if="user !== null">{{ user }} ({{ visits ?? 0 }})</p>
    <p v-else>{{ session.greeting }}|{{ visits === null }}</p>
  </div>
</template>
