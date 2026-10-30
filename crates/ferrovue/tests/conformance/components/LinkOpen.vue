<script setup lang="ts">
defineProps<{ to: string; extra: string; tone?: string }>();
</script>

<template>
  <nav>
    <RouterLink :to="to" aria-current-value="a&quot;<b>" active-class="on" exact-active-class="here" :class="[extra, tone ?? '']">{{ to }}</RouterLink>
    <RouterLink to="/account/orders" active-class="same" exact-active-class="same" :class="{ toned: tone }">orders</RouterLink>
    <RouterLink :to="'/users/' + extra" class="user">{{ extra }}</RouterLink>
  </nav>
</template>
