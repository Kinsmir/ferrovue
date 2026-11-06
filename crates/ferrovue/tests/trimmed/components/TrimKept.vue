<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<template>
  <div>
    <pre>
  {{ label }}
    <b> kept </b>
</pre>
    <textarea>
  typed
</textarea>
    <div v-pre>
      <b> {{ raw }} </b>
    </div>
    <div style="white-space: pre-wrap">
      <b> {{ label }} </b>
    </div>
    <p style="color: red">
      {{ label }} trimmed
    </p>
  </div>
</template>
