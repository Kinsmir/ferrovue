<script setup lang="ts">
defineProps<{ label: string; on?: boolean }>();
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
    <p class="note whitespace-pre-line">
      {{ label }}
      <button>
        kept
      </button>
    </p>
    <p :class="{ 'whitespace-pre-line': on }">
      {{ label }} bound
    </p>
    <p class="whitespace-pre">
      {{ label }} trimmed
    </p>
    <p style="color: red">
      {{ label }} trimmed
    </p>
  </div>
</template>
