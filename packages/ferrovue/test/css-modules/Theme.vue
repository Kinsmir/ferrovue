<template>
  <p :class="[theme.big, $style.plain, scoped.dot]" />
</template>

<style>
.global-only { color: red; }
</style>

<style module="theme">
.big { font-size: 2em; }
.small { font-size: 0.5em; }
</style>

<style module>
.plain { color: gray; }
</style>

<style module="scoped" scoped>
.dot { color: red; }
.wrap :deep(.inner) { color: red; }
:global(.page) .framed { margin: 0; }
.holder :slotted(.slotted) { margin: 0; }
.wrap ::v-deep(.legacy) { color: blue; }
</style>

<style module="titled" title="a b&c" data-x>
.titled { color: red; }
</style>

<style module="theme">
.again { color: red; }
</style>
