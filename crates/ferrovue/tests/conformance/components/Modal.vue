<script setup lang="ts">
/* `<Teleport>`: content sent to a target the page places — to two elements, nested, and
 * disabled, which keeps it in place. */
defineProps<{ title: string; open: boolean; inline: boolean }>();
</script>

<template>
  <div class="host">
    <button>{{ title }}</button>
    <Teleport to="#modals"><div v-if="open" class="modal"><h2>{{ title }}</h2><Teleport to="#modals"><p class="toast">saved</p></Teleport></div></Teleport>
    <Teleport to="#overlay" :disabled="inline"><aside>{{ title }} aside</aside></Teleport>
  </div>
</template>
