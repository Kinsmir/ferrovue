<script setup lang="ts">
/* What the template itself spells: entities, void elements, SVG's case-sensitive attributes,
 * whitespace that is kept and whitespace that is not. */
defineProps<{ name: string }>();
</script>

<template>
  <div>
    <p>a&nbsp;b &amp; c &lt;d&gt; &copy; “{{ name }}”</p>
    <br />
    <img src="https://example.com/x.png" alt="" />
    <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0L10 10" stroke-linecap="round" /></svg>
    <pre>  keep
    this  </pre>
    <p>
      collapse
      this
    </p>
  </div>
</template>
