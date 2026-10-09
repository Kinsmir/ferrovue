<template>
  <div :class="$style.card" />
</template>

<style module>
@value primary: #f00;
@value secondary: blue;
.card { padding: 1rem; }
.title, .active:hover { color: primary; }
.red-dash { color: red; }
.under_score { color: red; }
.Upper { color: red; }
:global(.outside) .inside { margin: 0; }
:global .wide :local(.narrow) { margin: 0; }
.comp { composes: title active; font-weight: bold; }
.comp2 { composes: comp; composes: outside from global; }
@keyframes spin { from { opacity: 0; } }
@keyframes :global(fade) { to { opacity: 1; } }
.anim { animation: spin 1s, fade 2s; }
.sm\:hidden { display: none; }
.\31 0x { width: 10px; }
.é { color: red; }
@media (min-width: 10px) { .wide-only { display: block; } }
.a .b > .c ~ .d + .e { color: red; }
#ident { color: red; }
.card.card { color: blue; }
</style>
