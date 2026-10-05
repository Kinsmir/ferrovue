<script setup lang="ts">
import FallBare from "./FallBare.vue";
import FallBinds from "./FallBinds.vue";
import FallFade from "./FallFade.vue";
import FallInner from "./FallInner.vue";
import FallLeaf from "./FallLeaf.vue";
import FallLink from "./FallLink.vue";
import FallPair from "./FallPair.vue";
import FallRoot from "./FallRoot.vue";
import FallSwitch from "./FallSwitch.vue";
import FallUse from "./FallUse.vue";

defineProps<{ label: string; title?: string; tone?: string; n: number; on: boolean; color?: string; note?: string }>();
</script>

<template>
  <article>
    <FallLeaf
      :label="label"
      class="extra"
      :class="{ on, off: !on }"
      id="given"
      data-k="v"
      :title="title"
      :style="{ color, fontWeight: n }"
      :aria-label="tone"
      :disabled="on"
      :hidden="!on"
      :data-n="n"
      @focus="() => undefined"
    />
    <FallLeaf label="plain" />
    <FallLeaf label="same" class="leaf" :note="note" />
    <FallLeaf label="hidden" :shown="on" style="display: flex" :data-tone="tone ?? 'none'" />
    <FallInner :label="label" class="passed" id="given" :title="title" :style="{ color }" data-x="1" />
    <FallInner label="bare" />
    <dl><FallPair :first="label" class="dropped" :title="title" /></dl>
    <FallRoot :text="title" class="outer" :data-via="tone" :title="label" />
    <FallRoot />
    <FallUse :class="[tone, 'used']" :title="title" data-use="1" :style="{ color }" />
    <FallLink to="/" :class="tone" :title="title" data-link="1" />
    <FallLink to="/search" />
    <FallBinds :cls="tone" :css="`color: ${color ?? 'red'}; top: 1px`" class="x" style="margin: 0" :title="note" />
    <FallBinds css="" :class="{ on }" />
    <FallSwitch :mode="on ? 'on' : 'off'" class="switched" :title="title" />
    <FallSwitch mode="none" class="lost" />
    <FallFade :text="label" :title="title" class="through" />
    <FallBare :class="title" :style="`margin: ${n}px`" :data-n="n" />
  </article>
</template>
