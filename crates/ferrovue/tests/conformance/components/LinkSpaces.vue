<script setup lang="ts">
import FallSpaces from "./FallSpaces.vue";

defineProps<{ to: string; own: string; tone?: string }>();
</script>

<template>
  <nav>
    <RouterLink :to="to" active-class=" on " exact-active-class="here">a</RouterLink>
    <RouterLink :to="to" active-class="o  n" exact-active-class=" here " class="tab">b</RouterLink>
    <RouterLink :to="to" active-class=" " exact-active-class="" :class="own">c</RouterLink>
    <RouterLink :to="to" active-class=" s " exact-active-class=" s " :class="[own, tone ?? '']">d</RouterLink>
    <RouterLink :to="to" active-class="on" exact-active-class="here" :class="own">e</RouterLink>
    <RouterLink :to="to" active-class="on" exact-active-class="here" class="on" :class="tone">f</RouterLink>
    <RouterLink :to="to" active-class="2" exact-active-class="1">g</RouterLink>
    <RouterLink :to="to" active-class=" a&quot;<b> " exact-active-class="&amp; ' x=">h</RouterLink>
    <FallSpaces :to="to" :class="own" />
    <FallSpaces :to="to" :class="[own]" />
  </nav>
</template>
