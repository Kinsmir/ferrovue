<script setup lang="ts">
/* Fallthrough with scope ids: a scoped parent's id follows the attributes it passes, on a root of
 * the child's own, through a root that is a component (which holds the ids as attributes it passes
 * on), with `inheritAttrs: false`, and on a `<RouterLink>`. */
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
