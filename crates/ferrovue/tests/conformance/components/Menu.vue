<script setup lang="ts">
/* `<RouterLink>` imported rather than resolved by name, with object locations — named, with
 * parameters, a query and a hash, or a path — and its own class names and `aria-current`. */
import { RouterLink } from "vue-router";

defineProps<{ slug: string; q?: string; page: number; tab?: string }>();
</script>

<template>
  <nav>
    <RouterLink :to="{ name: 'home' }" active-class="on" exact-active-class="here">home</RouterLink>
    <RouterLink :to="{ name: 'post', params: { slug } }" class="post" aria-current-value="location">{{ slug }}</RouterLink>
    <RouterLink :to="{ name: 'post-tab', params: { slug, tab: tab ?? 'view' }, hash: '#top' }" active-class="same" exact-active-class="same">tab</RouterLink>
    <RouterLink :to="{ name: 'search', query: { q, page, empty: '' } }" replace>search</RouterLink>
    <RouterLink :to="{ path: '/users/' + slug, query: { from: 'menu' } }" :class="{ user: true }">user</RouterLink>
  </nav>
</template>
