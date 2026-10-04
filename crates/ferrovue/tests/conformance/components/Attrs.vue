<script setup lang="ts">
/* Attributes: boolean, empty, numeric, absent, `data-` and `aria-`, and every shape of `class`. */
defineProps<{
  label: string;
  disabled: boolean;
  hidden: boolean;
  tabindex: number;
  tip?: string;
  extra: string;
  state: string;
  id?: string;
}>();
</script>

<template>
  <form>
    <button type="button" :disabled="disabled" :title="label" :aria-label="label" :data-state="state" :tabindex="tabindex">{{ label }}</button>
    <label :for="id" :hidden="hidden">{{ label }}</label>
    <input :value="label" :placeholder="tip" :readonly="disabled" />
    <span class="static" :class="extra"></span>
    <span :class="['a', extra, 'b', state]"></span>
    <span :class="[' padded ', '']"></span>
    <span :class="state" class="after"></span>
    <span :title="tip ?? ''" :data-empty="''"></span>
  </form>
</template>
