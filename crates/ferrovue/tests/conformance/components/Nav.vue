<script setup lang="ts">
/* Links that know where the reader is. */
export interface Props {
  href: string;
  label: string;
  note?: string;
}

defineProps<Props>();
</script>

<template>
  <nav><RouterLink to="/blog/intro" class="tab">intro</RouterLink> <RouterLink :to="href" :title="label" :class="['tab', note ? 'noted' : '']">{{ label }}<i v-if="note">{{ note }}</i></RouterLink></nav>
</template>
