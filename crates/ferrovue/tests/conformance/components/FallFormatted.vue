<script setup lang="ts">
import FallLeaf from "./FallLeaf.vue";
import FallLink from "./FallLink.vue";

defineProps<{ label: string; tone: string; n: number; note?: string }>();
</script>

<template>
  <section>
    <FallLeaf
      label="formatted"
      :id="`${tone}${tone}`"
      :title="`${tone}-${n}`"
      :data-empty="`${tone}${label}`"
      :aria-label="`${label} ${n}`"
    />
    <FallLeaf label="over" :note="note" :title="`[${tone}]`" :data-n="`${n}`" />
    <FallLink to="/" :title="`${tone}${label}`" :data-tone="`${tone}!`" />
  </section>
</template>
