<script setup lang="ts">
defineProps<{ on: boolean; tone: string }>();
</script>

<template>
  <component :is="on ? 'section' : 'div'">
    <p class="a  b" :class="{ big: on }" id="p"></p>
    <br title="t" class="card" :class="[tone, 'x']" />
    <i :class="tone" class="z" />
    <component :is="on ? 'b' : 'em'"><span class="s" :class="tone">{{ tone }}</span></component>
  </component>
</template>
