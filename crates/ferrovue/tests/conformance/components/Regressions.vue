<script setup lang="ts">
/* Cases the randomised differential tester found (fuzz/failures/), kept so they stay fixed: integer
 * literals beyond what a double holds exactly, and `?:` / `||` choosing between a string the
 * component holds and one it builds; class objects whose names repeat or are array indices, which
 * a JavaScript object lists first; JavaScript's -0; and a number exactly halfway between two
 * shortest spellings; a branch that trims a string it has just built; and strings and lists built
 * in place — `?? (1).toFixed(1)`, `.at()` of a built string in a branch, `.split()` then `.slice()` —
 * whose borrows outlived them. */
defineProps<{ s1: string; b0: boolean; os1?: string; ob2?: boolean; f2: number; l2: string[]; l4: number[]; n3: number }>();
</script>

<template>
  <div>
    <p>{{ 1e21 }}|{{ 1e20 }}|{{ 9007199254740993 }}</p>
    <i :alt="1e20" :id="1e21"></i>
    <b :placeholder="s1.startsWith('Σ') ? s1 : (1).toFixed(0)"></b>
    <p>{{ b0 ? 'a' : ('' + 'ß') }}|{{ s1 || (s1 + s1) }}|{{ 'é' || (0.5).toFixed(3) }}</p>
    <a :tabindex="0.5 ? 'a' : (1).toString()"></a>
    <a :data-n="0.5 ? 'a'.toLowerCase() : '&amp;'"></a>
    <header :data-x="1 ? (0.5).toString() : ', '"></header>
    <i :title="6 ? (0.5).toFixed(1) : 'a'"></i>
    <ul v-if="os1"><li :lang="ob2 ? (os1 + os1) : os1"></li></ul>
    <footer :class="{ [String(f2)]: 'a&b', [(0).toFixed(0)]: 1 }"></footer>
    <em :class="{ active: true, [(100 / 42).toFixed(0)]: 'a' }"></em>
    <ul :class="{ big: true, [String(l2.length)]: 'a' }"></ul>
    <b :class="{ [l2.join('-')]: '&amp;', [l2.join('-')]: true }"></b>
    <ol :class="{ on: true, [l4.join(', ')]: 1 }"></ol>
    <li :class="{ [s1.trimEnd()]: true, [s1 || s1]: s1 }"></li>
    <a :class="{ [s1.trim()]: 2.25, [s1]: 7 }"></a>
    <p :class="{ [` & ${'-'}🦀${'x y'}px`]: 1, [l4.length.toFixed(0)]: 2 }"></p>
    <i :class="{ 2: true, 1: true, b: true, a: f2 }"></i>
    <p>{{ 'a' ? 'a' : (1).toFixed(2).trim() }}|{{ ' pad ' ? 'a' : '-'.toUpperCase().trimEnd() }}|{{ (true && true) ? 'a' : (1).toFixed(10).trimStart() }}|{{ b0 ? 'a' : (f2).toFixed(2).trim() }}|{{ s1.trim() || (s1 + 'x').trim() }}</p>
    <p v-if="os1">{{ os1 ? os1.toUpperCase().trimEnd() : 'a' }}</p>
    <p :data-n="7 / (-l2.length)">{{ 0.5 / ((-5) * 0) }}|{{ n3 / s1.length }}|{{ -0 }}|{{ 1 / -f2 }}</p>
    <p>{{ (os1 ?? (1).toFixed(1)) || 'a' }}|{{ b0 ? (String(f2).at(-1) ?? ', ') : 'x' }}|{{ `🦀${s1}`.split(',').slice(1, 1.005).includes('x y') }}</p>
    <i v-for="w in (f2).toFixed(3).split('.').slice(0, -1)">{{ w }}</i>
  </div>
</template>
