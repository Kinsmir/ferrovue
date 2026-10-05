<script setup lang="ts">
defineProps<{ chips: string[]; counts?: number[]; marks?: Record<string, number> }>();
</script>

<template>
  <span class="chips"><b v-for="c in chips">{{ c }}</b><i v-if="counts">{{ counts.join("+") }}</i><template v-if="marks"><u v-for="(m, k) in marks" :title="k">{{ m }}</u></template></span>
</template>
