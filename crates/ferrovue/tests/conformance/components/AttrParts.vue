<script setup lang="ts">
import type { Float } from "ferrovue/types";

defineProps<{ rank: number; score: Float; sub: string; tail: string; on: boolean; maybe?: Float; big: number; tags: string[] }>();
</script>

<template>
  <li
    :aria-label="'rank ' + rank"
    :title="sub + tail"
    :data-sub="sub"
    :data-mid="`${sub}${rank}${tail}`"
    :data-lit="'only' + ''"
    :data-empty="sub + ''"
    :data-score="score + ' points'"
    :data-tpl="`${sub}`"
    :data-flag="`${on}${sub}`"
    :data-opt="`m${maybe}`"
    :data-ratio="`${score / big}`"
    :data-tail="tail + '/'"
  >
    <a
      :href="'/r/' + sub + '/'"
      :title="score + ' points'"
      :data-tpl="`/r/${sub}/${rank}`"
      :data-pair="sub + tail"
      :data-only="tail"
      :data-ratio="score / rank + ''"
      :data-big="big + '|' + -big"
      :data-opt="`${maybe}|${tags}`"
      :data-str="'n' + rank.toString() + String(score)"
      :data-flag="`${on}:${!on}`"
      >{{ 'rank ' + rank }} {{ `${sub}/${score}` }}</a
    >
  </li>
</template>
