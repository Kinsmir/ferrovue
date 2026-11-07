<script setup lang="ts">
import TrimButton from "./TrimButton.vue";

defineProps<{ label: string; name: string }>();
</script>

<template>
  <div>
    <p>
      <span> by </span><a>{{ name }}</a>
      <span>signed in through </span>{{ label }}
      <span> · </span>
      <b>
        {{ label }} and </b>
      <i> to {{ name }}
      </i>
      <em>&#10;to {{ label }} by&#10;</em>
      <TrimButton kind="inline"> to {{ label }} </TrimButton>
    </p>
    <p class="tagline">
      submitted <span class="tagline-word">by</span>
      <a class="author" :href="`/u/${name}`">{{ name }}</a>
      <b v-if="label">{{ label }}</b>
      <i v-else>none</i>
      <img alt="">
      <TrimButton kind="next" />
      <span>after</span>
    </p>
    <ul>
      <li>{{ label }}</li>
      <li>{{ name }}</li>
    </ul>
  </div>
</template>
