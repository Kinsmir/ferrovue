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
    <p class="byline">
      submitted <time :title="label">{{ label }}</time>
      <template v-if="name"
        ><span class="tagline-word">by</span>
        <a :href="`/u/${name}`">{{ name }}</a>
        <TrimButton v-if="label" :kind="label" /></template
      ><template v-else
        ><span class="tagline-word">by</span> <span class="author-deleted">[deleted]</span></template
      >
      <template v-if="label"
        ><span class="tagline-word">to</span>
        <a :href="'/r/' + label + '/'">/r/{{ label }}</a></template
      >
    </p>
    <ul>
      <li>{{ label }}</li>
      <li>{{ name }}</li>
    </ul>
  </div>
</template>
