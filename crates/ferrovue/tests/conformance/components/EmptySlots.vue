<script setup lang="ts">
import DataList from "./DataList.vue";
import Frame from "./Frame.vue";

defineProps<{ title: string }>();
</script>

<template>
  <div>
    <Frame :title="title"><template #default></template></Frame>
    <Frame :title="title"><!-- only a comment --></Frame>
    <Frame :title="title"><template #head></template>{{ title }}</Frame>
    <Frame :title="title"><template #head><!-- a comment --></template><template #default><!-- another --></template></Frame>
    <DataList :rows="[]" :title="title"><template #header="sp"></template></DataList>
    <DataList :rows="[]" :title="title"><template #header="{ note }"><!-- {{ note }} --></template><template #default="_"></template></DataList>
  </div>
</template>
