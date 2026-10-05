<script setup lang="ts">
import { computed } from "vue";
import TagHeading from "./TagHeading.vue";

const props = defineProps<{ level: "h1" | "h2" | "h3"; title: string; note?: string; rule: "hr" | "br"; ordered: boolean }>();

const listTag = computed(() => (props.ordered ? "ol" : "ul"));
</script>

<template>
  <article>
    <TagHeading :as="level" :text="title" data-role="title"><em v-if="note">{{ note }}</em><template v-for="w in title.split(' ')"> {{ w }}</template></TagHeading>
    <TagHeading :text="title" />
    <component :is="rule" class="rule" />
    <component :is="listTag" :class="{ ordered }"><li v-for="w in title.split(' ')" :key="w">{{ w }}</li><slot /></component>
    <component is="h4">static {{ title }}</component>
    <Transition><component :is="level" v-if="note" :data-note="note">{{ note }}</component></Transition>
  </article>
</template>

<style scoped>
article {
  color: navy;
}
</style>
