<script setup lang="ts">
interface Group {
  name: string;
  members: string[];
  lead?: string;
}

defineProps<{ words: string[]; numbers: number[]; groups: Group[] }>();
</script>

<template>
  <section>
    <ul><li v-for="w in words">{{ w }}</li></ul>
    <ol><li v-for="(n, i) in numbers" :data-index="i">{{ n }}<template v-if="i === 0"> first</template></li></ol>
    <div v-for="g in groups" class="group">
      <h3>{{ g.name }} ({{ g.members.length }})</h3>
      <b v-if="g.lead">{{ g.lead }}</b>
      <template v-for="(m, j) in g.members"><span>{{ j }}:{{ m }}</span>,</template>
    </div>
    <p v-if="!words.length">no words</p>
  </section>
</template>
