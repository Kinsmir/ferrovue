<script setup lang="ts">
import FallInner from "./FallInner.vue";
import FallLeaf from "./FallLeaf.vue";
import FallLink from "./FallLink.vue";
import FallRoot from "./FallRoot.vue";

defineProps<{ label: string; tone?: string }>();
</script>

<template>
  <div class="scoped">
    <FallLeaf :label="label" class="s" :data-tone="tone" :title="label" />
    <FallRoot :text="label" :class="tone" data-k="k" />
    <FallInner :label="label" :data-tone="tone" />
    <FallLink to="/" :title="tone" />
  </div>
</template>

<style scoped>
.scoped {
  color: navy;
}
</style>
