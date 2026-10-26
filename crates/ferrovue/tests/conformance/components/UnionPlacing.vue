<script setup lang="ts">
import type { Align, Shade } from "../types/unions";

interface Place {
  align: Align;
  shade: Shade;
}

interface Slot {
  place?: Place;
  align: Align;
}

defineProps<{ place?: Place; places: Place[]; named: Record<string, Place>; slot: Slot; slots: Slot[] }>();
</script>

<template>
  <section>
    <p v-if="place" :class="place.align">{{ place.shade }}</p>
    <ul>
      <li v-for="(p, i) in places" :key="i" :class="p.align">{{ p.shade }}</li>
    </ul>
    <dl>
      <template v-for="(p, k) in named" :key="k">
        <dt>{{ k }}</dt>
        <dd :class="p.align">{{ p.shade }}</dd>
      </template>
    </dl>
    <p :class="slot.align">{{ slot.place?.shade ?? "none" }}</p>
    <ol>
      <li v-for="(s, i) in slots" :key="i" :class="s.align">{{ s.place?.align ?? "-" }}</li>
    </ol>
  </section>
</template>
