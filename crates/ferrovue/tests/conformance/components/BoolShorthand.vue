<script setup lang="ts">
import BoolKid from "./BoolKid.vue";

defineProps<{ label: string; on: boolean }>();
</script>

<template>
  <div>
    <BoolKid flag :label="label" />
    <BoolKid flag="flag" opt="opt" :label="label" />
    <BoolKid flag foo-bar opt :label="label" />
    <BoolKid flag foo-bar="foo-bar" :label="label" />
    <BoolKid :flag="on" fooBar="foo-bar" :label="label" />
    <BoolKid :flag="''" :opt="`opt`" :foo-bar="''" :label="label" />
    <BoolKid v-bind="{ flag: '', opt: 'opt' }" :label="label" />
    <BoolKid :flag="false" :label="label" />
    <BoolKid :flag="on" :opt="on" :label="label" />
  </div>
</template>
