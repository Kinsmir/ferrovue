<script setup lang="ts">
/* What a component reads from the route: through `useRoute()` in setup and `$route` in the
 * template — the path, the hash, the name and the parameters. */
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";

defineProps<{ label: string }>();
const route = useRoute();
const router = useRouter();
const slug = computed(() => route.params.slug ?? "none");
const onPost = computed(() => route.name === "post");
</script>

<template>
  <dl :data-route="route.name" @click="router.back()">
    <dt>{{ label }}</dt>
    <dd>{{ route.path }}|{{ route.hash }}|{{ $route.name }}|{{ slug }}|{{ $route.params.tab }}|{{ route.params['slug'] }}</dd>
    <dd v-if="onPost">a post</dd>
    <dd v-if="route.params.tab === 'edit'">editing</dd>
  </dl>
</template>
