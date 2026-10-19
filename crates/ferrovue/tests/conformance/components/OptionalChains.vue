<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";

interface Profile {
  bio: string;
  site?: string;
}

interface User {
  name: string;
  nick: string | null;
  langs: string[];
  profile?: Profile;
}

const props = defineProps<{ user: User | null; title?: string; tags?: string[]; count?: number; ratio: Float | null; users: User[]; when?: Date; seen: Date | null }>();

const loud = computed(() => props.title?.toUpperCase());
const kept = computed(() => props.tags?.filter((t) => t.trim() !== "").length ?? 0);
const bio = computed(() => props.user?.profile?.bio.trim() ?? "no bio");
const firstLang = computed(() => props.users[0]?.langs.at(0));
</script>

<template>
  <p>{{ title?.length }}|{{ title?.trim() }}|{{ title?.trim().length }}|{{ title?.toUpperCase() }}|{{ title?.slice(1) }}|{{ title?.at(-1) }}|{{ title?.split(",").length }}|{{ title?.padStart(6, "*") }}|{{ title?.replace("a", "$&$&") }}</p>
  <p>{{ tags?.length }}|{{ tags?.join("-") }}|{{ tags?.includes("b") }}|{{ tags?.indexOf("b") }}|{{ tags?.[1] }}|{{ tags?.at(-1)?.toUpperCase() }}|{{ tags?.map((t) => t.length).join(",") }}|{{ tags?.filter((t) => t !== "b").length }}|{{ JSON.stringify(tags?.slice(1) ?? []) }}</p>
  <p>{{ user?.name }}|{{ user?.name.length }}|{{ user?.nick }}|{{ user?.nick?.trim() }}|{{ user?.langs.length }}|{{ user?.langs.join("+") }}|{{ user?.profile?.bio }}|{{ user?.profile?.site?.length }}|{{ user?.profile?.bio.toLowerCase() }}|{{ user?.langs.find((l) => l.startsWith("r")) }}</p>
  <p>{{ count?.toFixed(2) }}|{{ count?.toString() }}|{{ ratio?.toFixed(1) }}|{{ (count ?? 0) + 1 }}|{{ loud }}|{{ kept }}|{{ bio }}|{{ firstLang }}|{{ users[1]?.profile?.site ?? "no site" }}</p>
  <p>{{ when?.getTime() }}|{{ seen?.getUTCFullYear() ?? 0 }}|{{ when?.toUTCString() }}|{{ seen?.toJSON() }}|{{ when?.toJSON()?.length }}|{{ seen?.toUTCString().length ?? -1 }}</p>
  <p v-if="title?.trim()">titled {{ title?.trim() }}</p>
  <p v-else>untitled</p>
  <p v-if="tags?.length">{{ tags?.length }} tags</p>
  <p v-if="user?.profile?.site !== undefined">site</p>
  <p v-if="user?.nick == null">no nick</p>
  <ul>
    <li v-for="t in tags?.filter((t) => t.length > 1) ?? []" :key="t">{{ t }}</li>
    <li v-for="l in user?.langs ?? []" :key="l">{{ l }}</li>
  </ul>
</template>
