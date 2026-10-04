<script setup lang="ts">
/* Setup state the server evaluates (`ref`, `computed`), helpers with Rust twins, and client-only code
 * the template reaches only from event handlers. */
import { computed, ref } from "vue";
import { isEven, orDash, plural, tone } from "./helpers";

const props = defineProps<{ count: number; score?: number; name?: string }>();
const heading = ref("Results");
const none = computed(() => props.count === 0);
const label = computed(() => props.count + " item" + plural(props.count));
const open = ref(false);
function toggle() {
  open.value = !open.value;
}
</script>

<template>
  <div :class="['setup', tone(score)]" @click="toggle">
    <h2>{{ heading }}</h2>
    <p>{{ label }}</p>
    <p v-if="isEven(count)">even</p>
    <p v-if="none">nothing yet</p>
    <p>{{ orDash(name) }}</p>
  </div>
</template>
