<script setup lang="ts">
import { computed } from "vue";
import ShapeCircle from "./ShapeCircle.vue";
import ShapeSquare from "./ShapeSquare.vue";
import ShapeRoot from "./ShapeRoot.vue";
import { SHAPES, type Shape } from "../types/shapes";

const props = defineProps<{ shape: Shape; label: string; boxed: boolean }>();

const LOCAL = { circle: ShapeCircle, square: ShapeSquare } as const;
const chosen = computed(() => (props.shape === "circle" ? ShapeCircle : ShapeSquare));
</script>

<template>
  <div class="picker">
    <component :is="chosen" :label="label" class="picked" data-form="computed">{{ label }}</component>
    <component :is="LOCAL[shape]" :label="label" data-form="local" />
    <component :is="SHAPES[shape]" :label="label" :size="3" data-form="imported"><template #corner>{{ label }}!</template></component>
    <component :is="ShapeCircle" :label="label" data-form="direct" />
    <component :is="boxed ? ShapeSquare : 'em'" :label="label" data-form="mixed">{{ label }}</component>
    <KeepAlive><component :is="chosen" :label="label" /></KeepAlive>
    <Transition name="fade"><component :is="LOCAL[shape]" :label="label" /></Transition>
    <ShapeCircle :label="label"><component :is="boxed ? 'i' : 'u'">{{ label }}</component></ShapeCircle>
    <ShapeRoot :shape="shape" :label="label" data-id="rooted"><i v-if="boxed">in</i><component :is="boxed ? 'i' : 'u'"><b>{{ label }}</b></component></ShapeRoot>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
}
</style>
