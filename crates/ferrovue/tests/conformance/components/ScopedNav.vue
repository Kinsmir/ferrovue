<script setup lang="ts">
/* `<RouterLink>` in a scoped component, which vue-router renders from virtual nodes: the id on the
 * `<a>` after its attributes and on the elements and components inside it, a link that is a scoped
 * component's root, and one in slot content given a `:slotted()` component's id. */
import ScopedCard from "./ScopedCard.vue";
import ScopedLeaf from "./ScopedLeaf.vue";
import ScopedLink from "./ScopedLink.vue";

defineProps<{ href: string; label: string }>();
</script>

<template>
  <nav class="nav">
    <RouterLink to="/blog/intro" class="tab">intro</RouterLink>
    <RouterLink :to="href" :title="label">{{ label }} <i>{{ href }}</i><ScopedLeaf :label="label" /></RouterLink>
    <ScopedLink :to="href" />
    <ScopedCard><RouterLink to="/">home {{ label }}</RouterLink><ScopedLeaf label="carded" /></ScopedCard>
  </nav>
</template>

<style scoped>
.nav a {
  margin-right: 1em;
}
</style>
