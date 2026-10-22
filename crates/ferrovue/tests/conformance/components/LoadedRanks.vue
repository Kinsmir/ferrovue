<script setup lang="ts">
import { useHead } from "@unhead/vue";
import LoadedComments from "./LoadedComments.vue";
import RankLine from "./RankLine.vue";
import { loadRanking } from "./loaders";

const props = defineProps<{ board: string }>();
const ranking = await loadRanking(props.board);
useHead({ meta: [{ name: "description", content: `ranks of ${props.board}` }] });
</script>

<template>
  <ol>
    <li v-for="(score, name) in ranking.scores" :key="name">{{ name }}: {{ score }}</li>
  </ol>
  <RankLine :best="ranking.best" :worst="ranking.worst" :open="ranking.open" />
  <Teleport to="#ranks">
    <p class="board">{{ board }}</p>
  </Teleport>
  <LoadedComments :article="board" :page="1" />
</template>
