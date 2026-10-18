<script setup lang="ts">
defineProps<{ label: string; n: number; on: boolean; tip?: string; tone: string }>();
</script>

<template>
  <div class="box" v-bind="{ id: label, title: tip, 'data-n': n, 'aria-pressed': on, hidden: on }" data-own="x">
    <a class="own" v-bind="{ href: label, class: [on ? 'on' : 'off'] }">{{ label }}</a>
    <span title="own" v-bind="{ title: label, style: { '--tone': tone } }" style="margin: 0">{{ n }}</span>
    <input v-bind="{ value: label, disabled: on, type: 'text' }" />
    <p v-bind="{ 'data-tip': tip ?? 'none', class: [tone, { lit: on }] }"></p>
  </div>
</template>
