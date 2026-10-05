<script setup lang="ts">
import Blank from "./Blank.vue";
import DataList from "./DataList.vue";
import Forward from "./Forward.vue";
import Frame from "./Frame.vue";

defineProps<{ note?: string; pad?: string; tags: string[]; on: boolean }>();
</script>

<template>
  <div>
    <Frame title="lead">{{ note }}<footer v-for="t in tags.filter(() => note)">{{ t }}</footer></Frame>
    <Frame title="trail"><i v-for="t in tags">{{ t }}</i>{{ note }}</Frame>
    <Frame title="alone">{{ note }}</Frame>
    <Frame title="branch"><template v-if="on">{{ note }}{{ pad }}</template></Frame>
    <Frame title="nested"><template v-for="t in tags">{{ note }}<template v-if="on">{{ pad }}</template></template></Frame>
    <Frame title="spaced"><b v-if="on">x</b> {{ pad }} <i v-if="!on">y</i></Frame>
    <Frame title="blank"><Blank :show="on" /></Frame>
    <Frame title="named"><template #head>{{ pad }}<em v-for="t in tags.filter(() => on)">{{ t }}</em></template>{{ pad }}<template v-if="on">{{ note }}</template></Frame>
    <DataList :rows="[]" title="scoped" :note="note"><template #header="{ note: n }"><template v-if="on">{{ n }}{{ pad }}</template><s v-for="t in tags.filter(() => n)">{{ t }}</s></template></DataList>
    <Forward title="forwarded">{{ note }}<u v-for="t in tags.filter(() => note)">{{ t }}</u></Forward>
    <Forward title="forwarded-branch"><template v-if="on">{{ pad }}{{ note }}</template></Forward>
  </div>
</template>
