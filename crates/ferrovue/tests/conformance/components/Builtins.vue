<script setup lang="ts">
import { vFocus } from "./directives";

defineProps<{ on: boolean; text: string; items: string[] }>();
</script>

<template>
  <div>
    <Transition name="fade"><p v-if="on">shown</p></Transition>
    <TransitionGroup tag="ul" name="list"><li v-for="i in items" :key="i">{{ i }}</li></TransitionGroup>
    <TransitionGroup><b v-for="i in items" :key="i">{{ i }}</b></TransitionGroup>
    <KeepAlive><span>kept</span></KeepAlive>
    <Suspense><em>{{ text }}</em></Suspense>
    <p v-text="text"></p>
    <p v-once>{{ text }}</p>
    <p v-pre>{{ not interpolated }}</p>
    <p v-memo="[text]">{{ text }}</p>
    <input v-focus class="focused" :value="text" />
  </div>
</template>
