<script setup lang="ts">
import type { Float } from "ferrovue/types";
import OnPropsKid from "./OnPropsKid.vue";
import OnPropsBare from "./OnPropsBare.vue";
import type { Props as BareProps } from "./OnPropsBare.vue";

defineProps<{ n: number; text: string; flag: boolean; r: Float; tone: "" | "warm" | "cold"; bare: BareProps }>();
const picked: string[] = [];
function pick(what: string) {
  picked.push(what);
}
</script>

<template>
  <section>
    <OnPropsKid :on1="n" :on-text="text" :on-flag="flag" :on-set="flag" :on-rate="Math.sqrt(r)" :on-tone="tone" :on-req="flag" :on-num="n" />
    <OnPropsKid :on1="n" :on-flag="flag" :on-set="flag" :on-rate="-r" :on-req="flag" :on-num="3" v-bind="{ onText: text, onTone: tone }" />
    <OnPropsBare v-bind="bare" />
    <OnPropsBare v-bind="bare" @picked="pick" />
  </section>
</template>
