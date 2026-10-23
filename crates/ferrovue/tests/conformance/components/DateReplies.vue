<script setup lang="ts">
import type { Reply } from "../types/dated";

defineProps<{ replies: Reply[]; depth: number }>();
</script>

<template>
  <ul>
    <li v-for="(reply, i) in replies" :key="i">
      <b>{{ reply.author }}</b>
      <time v-if="reply.at.getTime() === reply.at.getTime()" :datetime="reply.at.toISOString()">{{ reply.at.getUTCDate() }}</time>
      <i v-else>{{ reply.at.getTime() }}</i>
      <span v-if="reply.edited && reply.edited.getTime() > reply.at.getTime()">edited {{ reply.edited.getUTCMinutes() }}</span>
      <span v-if="reply.removed">removed {{ reply.removed.getUTCFullYear() }}</span>
      <DateReplies v-if="depth < 2 && reply.replies.length" :replies="reply.replies" :depth="depth + 1" />
    </li>
  </ul>
</template>
