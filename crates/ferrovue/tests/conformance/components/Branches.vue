<script setup lang="ts">
/* `v-if` chains, negation, compound tests, comparisons, and narrowing of optional values. */
interface Author {
  name: string;
  url?: string;
}

defineProps<{ kind: string; count: number; on: boolean; author?: Author; note?: string; score?: number }>();
</script>

<template>
  <div>
    <p v-if="kind === 'a'">a</p>
    <p v-else-if="kind === 'b'">b</p>
    <p v-else-if="kind !== ''">other {{ kind }}</p>
    <p v-else>empty</p>
    <i v-if="!on">off</i>
    <i v-if="on && count">on and counted</i>
    <i v-if="!count || !on">either</i>
    <i v-if="count === 3">three</i>
    <i v-if="note === undefined">no note</i>
    <i v-if="score !== undefined">scored {{ score }}</i>
    <i v-if="score">truthy score {{ score }}</i>
    <span v-if="author">by {{ author.name }}<a v-if="author.url" :href="author.url">link</a></span>
    <span v-else>anonymous</span>
    <em v-if="author && author.url">{{ author.url }}</em>
    <template v-if="on"><u>one</u><u>two</u></template>
  </div>
</template>
