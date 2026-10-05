<script setup lang="ts">
defineProps<{ order: string }>();
</script>

<template>
  <nav>
    <RouterLink :to="{ name: 'account' }">account</RouterLink>
    <RouterLink :to="{ name: 'account-home' }" active-class="in" exact-active-class="here">home</RouterLink>
    <RouterLink to="/account/orders" class="orders">orders</RouterLink>
    <RouterLink :to="{ name: 'order', params: { order } }" active-class="same" exact-active-class="same">order {{ order }}</RouterLink>
  </nav>
</template>
