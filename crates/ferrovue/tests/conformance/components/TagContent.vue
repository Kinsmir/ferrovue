<script setup lang="ts">
import ShapeSquare from "./ShapeSquare.vue";
defineProps<{ tag: "div" | "form"; items: string[]; on: boolean; label: string }>();
</script>

<template>
  <component :is="tag" :class="['x', { on }]" :style="{ color: on ? 'red' : undefined }" :hidden="!on" data-a="1">
    <template v-if="on"><i>a</i>{{ label }}</template>
    <template v-else>none</template>
    <component :is="on ? 'b' : 'i'" :title="label"><u v-for="i in items" :key="i">{{ i }}</u></component>
    <ShapeSquare v-for="i in items" :key="i" :label="i"><template #corner>c{{ i }}</template></ShapeSquare>
    <TransitionGroup tag="ul"><li v-for="i in items" :key="i">{{ i }}</li></TransitionGroup>
    <Transition><p v-if="on">t</p></Transition>
    <KeepAlive><ShapeSquare :label="label" /></KeepAlive>
    <button :disabled="!on" type="button">b</button>
    <!-- a comment -->
    <img alt="" :src="label" />
    {{ items.length }} &lt; {{ label.trim() }}
  </component>
</template>
