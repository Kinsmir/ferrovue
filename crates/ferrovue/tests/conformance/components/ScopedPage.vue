<script setup lang="ts">
import PlainBox from "./PlainBox.vue";
import PlainForward from "./PlainForward.vue";
import ScopedCard from "./ScopedCard.vue";
import ScopedFade from "./ScopedFade.vue";
import ScopedLeaf from "./ScopedLeaf.vue";
import ScopedPair from "./ScopedPair.vue";
import ScopedRack from "./ScopedRack.vue";
import ScopedRoot from "./ScopedRoot.vue";
import ScopedShelf from "./ScopedShelf.vue";

defineProps<{ title?: string; items: string[]; tone?: string; show: boolean }>();
</script>

<template>
  <main class="page" :data-tone="tone">
    <h1 v-if="title">{{ title }}</h1>
    <template v-if="items.length">
      <ul><li v-for="i in items" :key="i">{{ i }}</li></ul>
    </template>
    <ScopedLeaf :label="title" />
    <ScopedRoot :label="title ?? 'untitled'" />
    <dl><ScopedPair term="tone" :text="tone ?? 'plain'" /></dl>
    <PlainBox :text="title ?? 'untitled'"><i>in a plain box</i><ScopedLeaf label="nested" /></PlainBox>
    <ScopedCard :tone="tone">
      <template #title><b>{{ title }}</b></template>
      <p>body</p>
      <ScopedLeaf label="slotted" />
      <PlainBox text="boxed"><u>deeper</u></PlainBox>
      <template #footer="{ count }"><span>{{ count }} items</span><ScopedLeaf :label="String(count)" /></template>
    </ScopedCard>
    <PlainForward><em>forwarded</em><ScopedLeaf label="forwarded" /><PlainForward><s>twice</s><ScopedLeaf /></PlainForward></PlainForward>
    <ScopedShelf><mark>shelved</mark><ScopedLeaf label="shelved" /></ScopedShelf>
    <ScopedRack><b>racked</b><ScopedLeaf label="racked" /></ScopedRack>
    <ScopedFade :open="show" />
    <Transition><p v-if="show" class="note">fading</p></Transition>
    <KeepAlive><ScopedLeaf label="kept" /></KeepAlive>
    <Teleport to="#modals"><div class="modal">{{ title }}<ScopedLeaf label="teleported" /></div></Teleport>
    <slot name="extra">fallback <b>extra</b></slot>
  </main>
</template>

<style scoped>
.page {
  display: grid;
}
</style>
