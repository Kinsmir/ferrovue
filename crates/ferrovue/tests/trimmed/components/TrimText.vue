<script setup lang="ts">
defineProps<{ label: string; name: string; items: string[]; on: boolean }>();
</script>

<template>
  <section>
    <button type="button">
      remove
    </button>
    <p>
      Hello {{ name }}
    </p>
    <p>
      {{ name }} and {{ label }}
    </p>
    <p><b>{{ label }}</b> <i>{{ name }}</i></p>
    <p>
      <span>{{ label }}</span>
      tail
    </p>
    <p>&nbsp;spaced&nbsp;</p>
    <ul>
      <li v-for="item in items" :key="item">
        {{ item }} item
      </li>
    </ul>
    <p v-if="on">
      shown
    </p>
    <p v-else>
      hidden
    </p>
    <p>a<template v-if="on"> and {{ label }} </template>c</p>
    <p>
      <template v-for="item in items" :key="item"> {{ item }}, </template>
    </p>
    <label>
      Name
      <input :value="name">
    </label>
  </section>
</template>
