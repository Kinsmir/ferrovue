<script setup lang="ts">
const pick = defineModel<string>({ required: true });
const maybe = defineModel<string>("maybe");
const chosen = defineModel<string | null>("chosen", { required: true });
</script>

<template>
  <form>
    <select v-model="pick"><option>a</option><option> b </option><option>null</option><option value="c">c</option><option>{{ pick }}</option></select>
    <select v-model="maybe"><option>a</option><option value="undefined">u</option><option value="null">n</option><option value="b">b</option></select>
    <input type="radio" value="b" v-model="maybe"><input type="radio" value="undefined" v-model="maybe"><input type="radio" value="null" v-model="chosen">
    <select v-model="chosen"><option>a</option><option value="null">n</option><option value="b">b</option></select>
  </form>
</template>
