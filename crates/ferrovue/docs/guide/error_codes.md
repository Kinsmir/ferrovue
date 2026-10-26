Every error the compiler raises has a stable code, shown as `error[FV0602]` and in the `code`
field of `ferrovue --format json`. A code names one kind of refusal and is never given to another:
one the compiler stops raising stays listed here, marked retired. The first two digits are the
area. [`errors_and_limits`](crate::guide::errors_and_limits) explains what the compiler refuses
and why. A warning, such as one for a deprecated configuration key, has a code of its own, shown as
`warning[FV1117]` and with the `severity` `"warning"` in JSON. A refusal at render time, which a
generated `try_render` returns as a [`Refused`](crate::render::Refused), has a code of this list too, which
[`Refused::code`](crate::render::Refused::code) gives.

This page is generated from the compiler's list in `packages/ferrovue/src/errors.ts` by
`pnpm errors:generate`; `pnpm test` fails when the two differ.

# Components and parsing: FV00xx

## FV0001

Source file that does not parse.

A `<script setup>` block, or a file it reads, is not valid TypeScript. The message is the parser's own, with the line and column where it stopped.

## FV0002

Component file Vue cannot parse.

Vue's single-file component parser reports an error in the file: a tag left open, two `<template>` or two `<script setup>` blocks, a block in the wrong place. The message is Vue's own, with the line and column it points at. Vite refuses the same file, so fix it there.

## FV0003

`<script>` without `setup`.

The compiler reads a component's props, bindings and types from `<script setup lang="ts">`. A component whose only script is a plain `<script>` (the Options API, `export default defineComponent({ … })`) is refused, as a child another component imports and as an island. Rewrite it with `<script setup lang="ts">`, or leave the script out if the template needs none; a plain `<script>` beside a `<script setup>` is read.

## FV0004

Component without a `<template>`.

The server render is translated from the component's `<template>`. A component that renders through a render function, `h()` or JSX has none to translate. Write its markup as a `<template>`.

## FV0005

Template Vue cannot compile.

Vue's template compiler reports an error in the `<template>`: a `v-else` with no `v-if` before it, an expression that does not parse, an end tag with no start tag. The message is Vue's own, with the line and column it points at. Vite refuses the same template, so fix it there.

## FV0006

Unexpected construct in Vue's compiled template.

The compiler met output of Vue's server compiler that it has no translation for. Please report it with the component that caused it.

## FV0007

Component file name that gives no Rust module of its own.

Each component is written to a Rust module named after its file in snake case (`UserCard.vue` is `user_card.rs`). A file name that is not letters, digits and `_` starting with a letter, two names with the same snake case (`FooBar.vue` and `Foo_bar.vue`), `Mod.vue`, and a name a module ferrovue writes for the project already has (`Types.vue`, `Stores.vue`) are refused.

## FV0008

`<template>` in another language than HTML.

The compiler reads the `<template>` as HTML. A `<template lang="pug">`, or any `lang` other than `html`, is refused: Vite runs it through its preprocessor first. Write the template in HTML.

## FV0009

`<template>` read from another file.

The compiler reads the template written inside the component's `<template>` block. A `<template src="./x.html">` is refused: Vite reads the template from that file. Move the file's markup into the `<template>` block.

# Script setup: FV01xx

## FV0101

`inheritAttrs` that is not `true` or `false`.

The compiler decides when compiling whether attributes a parent passes fall through to the root, so `inheritAttrs` in `defineOptions({ … })` or `export default { … }` is the literal `true` or `false`. A value from a variable or an expression is refused.

## FV0102

`watch` with `immediate`.

A `watch` with `immediate: true` runs its callback during setup, on the server too, where it may change state the template reads. ferrovue does not run the callback, so the page could differ from Vue's. A `watch` without `immediate` runs only on the client and is allowed. Drop `immediate`, write the starting value as a `computed`, or compute it in Rust and pass it as a prop.

## FV0103

Effect that runs once on the server.

`watchEffect`, `watchSyncEffect` and `watchPostEffect` run their function once during setup, on the server too, where it may change state the template reads. ferrovue does not run it. Use `watch`, which runs only on a change, or `onMounted`, which runs only in the browser.

## FV0104

`onServerPrefetch`.

`onServerPrefetch` awaits work on the server before Vue renders, which a Rust render function cannot run. Fetch the data in Rust and pass it in as props.

## FV0105

Statement in setup that could change what renders.

ferrovue translates setup to Rust and does not run it, so a statement that may change state the template reads (`count.value++`, `store.load()`, `items.push(x)`, a call of a function of another library) would render otherwise than Vue does. Lifecycle hooks such as `onMounted`, the compiler macros (`defineEmits`, `defineExpose`) and a `watch` without `immediate` are allowed. Move the statement into `onMounted` or an event handler, write the value as a `computed`, or compute it in Rust and pass it as a prop.

## FV0106

`defineAsyncComponent` of anything but a component of this project.

The server renders an async component as the component it loads, so the compiler must know which file that is. `defineAsyncComponent` is read when its loader, given alone or as `loader` in an options object, is `() => import("./Child.vue")` with a string literal naming a `.vue` file, and its result is bound to a plain name. A loader that computes the path, imports a package, or does more than return the import is refused.

## FV0107

Unsupported statement in setup.

Setup is read statement by statement: imports, `const` and `let` declarations, function declarations, interfaces, type aliases, enums and expression statements. Any other statement (`if`, `for`, `try`, a `class`, a block) is refused, as the compiler cannot tell what it leaves bound when the template renders. Move the logic into a `computed`, a helper with a Rust twin, or an event handler.

## FV0108

`...rest` in destructured props.

Each prop is a field of the component's Rust `Props` struct. `const { title, ...rest } = defineProps<…>()` would make `rest` an object of the props left over, which has no Rust type. Destructure each prop by name, or keep the whole `props` object and read `props.x`.

## FV0109

Destructured prop that is not a plain name.

A prop destructured from `defineProps` is bound to a plain name: `{ title }`, `{ title: heading }` or `{ size = "md" }`. A nested pattern (`{ user: { name } }`, `{ tags: [first] }`) is refused. Bind the prop by name and read its fields in the template (`user.name`).

## FV0110

Name imported from a module the compiler cannot resolve to a `.ts` file of the project.

The compiler reads constants and types from the project's own `.ts` files, which a component imports by a relative path or through an alias: the `compilerOptions.paths` (and `baseUrl`) of the tsconfig.json nearest the component, and of the projects it references, and, when the Vite plugin runs, Vite's `resolve.alias`. The message names the specifier and where it was looked for. A name imported from a package is available only on the client: in an event handler, or computed in Rust and passed as a prop.

## FV0111

Setup value typed as a union of string literals that may hold another string.

A `computed`, a `ref` or a constant of setup annotated as a union of string literals (`computed((): Tone | undefined => …)`, `ref<Tone>(…)`) is a string, which the compiler checks against its annotation where a child's prop or an object literal's field takes it as the union, a Rust enum. The compiler follows the narrowing TypeScript does by `===` and `!==` with a string literal, by a value's truth and by `||`, in `?:`, `&&` and `v-if`, and refuses the value, at its declaration, when its body may give another string: one the narrowing it follows leaves in (`x === "a" ? undefined : x` of `"a" | "b" | ""` may be `""`), or a string of no known members (`s as Tone`). Narrow the value by one of these tests, or give each branch a member of the union. See [`props`](crate::guide::props#unions-of-string-literals).

# Constants and enums: FV02xx

## FV0201

Constant that refers to itself.

A constant the compiler evaluates refers to itself, directly or through other constants (`const A = B` and `const B = A`, or `const C = { x: C.y }`), so it has no value to evaluate. Write the value out.

## FV0202

Enum member without a value after a string member.

An enum member without a value takes the one after the member before it, which a string member does not have. TypeScript refuses it as well. Give the member a value.

## FV0203

Enum member value that is not a string or number literal.

An enum member's value is a string or a number: a literal, or a constant of the same file that is one. A member whose value comes to `true`, `null`, a list or an object has no place in the union of literals the enum stands for. Give it a string or a number.

## FV0204

Field a constant object does not have.

A constant object or enum is read by a field it does not declare (`LABELS.titel`, `Tone.Lound`), or an object in a constant list typed with an interface holds a key the interface does not declare. JavaScript gives `undefined` for the field, which is almost always a misspelt name. Fix the name, or add the field to the constant or the interface.

## FV0205

Spread or hole in a constant list.

A constant list is evaluated item by item, each written in the list. A spread (`[...BASE, "x"]`) and a hole (`[1, , 3]`) are refused. Write every item out.

## FV0206

Computed or spread key in a constant object.

A constant object is evaluated key by key, each a plain name or a string or number literal. A computed key is allowed where the compiler evaluates it to a string or a number, as an enum member (`{ [Tone.Warn]: 1 }`). A computed key it cannot evaluate, a spread (`{ ...BASE }`), a method and `__proto__:` (which sets the object's prototype, whose fields JavaScript then reads as the object's own) are refused. Write each key and value out.

## FV0207

Constant that is not a literal.

A constant is evaluated when the component is compiled, as JavaScript evaluates it: its value is a string, number or boolean literal, `null`, arithmetic of numbers (`60 * MINUTE`, with `+`, `-`, `*`, `/`, `%`, and `**` where it gives an exact integer within ±2⁵³, which every engine agrees on), strings joined with `+` or a template literal (`` `${BASE}/feed` ``), a list or object of these, or another such constant of the same file (or a field of one). A call (`Date.now()`), a function, another operator and a constant imported from yet another file are refused where the template reads the constant. Write the value as a literal, or compute it in Rust and pass it as a prop. See [`props`](crate::guide::props#constants).

## FV0208

Constant object read whole.

A constant object has no Rust value of its own: each of its fields is written where the template reads it. Reading it whole (`{{ LABELS }}`, `:labels="LABELS"`) is refused. Read one field at a time (`LABELS.title`), make it a list of objects, which becomes a `const` in `types.rs`, or pass it as a prop. See [`props`](crate::guide::props#constants).

## FV0209

`null` in a constant list of plain values.

A constant list of strings, numbers or booleans becomes a Rust array of one type, which holds no `null`. Leave the `null` out, or write the list as objects, where a field that is `null` in some items is `T | null`.

## FV0210

Constant list of plain values of different types.

A constant list of strings, numbers or booleans becomes a Rust array of one type. Integers and fractions together are numbers, and allowed; strings, numbers and booleans together (`["a", 1]`) are refused. Write every item as one type.

## FV0211

Constant list mixing plain values and objects.

A constant list holds plain values of one kind, which become a Rust array, or objects, which become a `const` of a struct in `types.rs`. A list mixing the two, and a list of lists, are refused. Write the items as one kind, objects when they have more than one part.

## FV0212

Two constant lists with one Rust name.

Each constant list of objects becomes a `const` in `types.rs`, named in upper snake case after the constant and the fields that lead to the list. Two files whose lists come to the same name (`SORTS` in `a.ts` and in `b.ts`) would declare it twice. Rename one.

## FV0213

Object in a constant list without a required field.

A constant list declared with an interface (`const OPTIONS: Option[] = [ … ]`) has each object built as that interface's Rust struct, so every field the interface requires is written in each object. Add the field to the object, or make it optional in the interface (`x?: T`).

## FV0214

`null` for a field that is not nullable.

An object in a constant list declared with an interface has `null` for a field the interface does not declare `| null`, and the field's Rust type has no value for it. Declare the field `T | null`, or give it a value.

## FV0215

Field of the wrong type in a constant list's object.

An object in a constant list declared with an interface holds a value of another type than the interface gives its field (a string for a `number`), or a list or object for a field, which a constant list's struct does not hold. Write the value as the interface types it.

## FV0216

Field of an unsupported type in a constant list's objects.

When a constant list of objects is declared without an interface, ferrovue builds the struct of its items from the values it finds, each field a string, a number or a boolean. A field holding a list or an object is refused. Flatten the field into plain values, or compute the value in Rust and pass it as a prop.

## FV0217

Field that is only ever `null`.

When a constant list of objects is declared without an interface, ferrovue gives each field the type of its values, and a field that is `null` in every object has none. Declare the list with an interface that gives the field's type: `const OPTIONS: Option[] = [ … ]`.

## FV0218

Field `null` in some objects and absent in others.

When a constant list of objects is declared without an interface, a field that is `null` in some objects and absent in others would be `T | null` and `T | undefined` at once, and a Rust `Option` holds one kind of nothing, so `=== null` and the props sent to the client could not tell the two apart. Write `null` in each object that has no value, or leave the field out of each.

## FV0219

Field of different types across a constant list's objects.

When a constant list of objects is declared without an interface, each field becomes one Rust type. A field that holds values of different types (`{ id: 1 }` and `{ id: "2" }`) is refused; integers and fractions together are numbers, and allowed. Write the field as one type in every object.

## FV0220

Constant list's object type declared twice.

When a constant list of objects is declared without an interface, the type of its items is named after the constant (`SORTS` gives `SortsItem`), in the `types.rs` every component shares. A type of that name from another file, another list's or an interface, would be declared twice. Rename the constant, or declare the list with an interface.

## FV0221

Constant list's object type named as a Rust type. Retired in 0.10.0: the compiler no longer raises it.

## FV0222

Constant object read by a key that is not a union of literals.

A constant object or enum read by a key chosen at run time (`PAD[size]`, `Tone[props.tone]`) compiles to a `match` over the key's members when the key's type is a closed set: a union of string or integer literals, an `enum` of them, or a key built from one by `.toUpperCase()`, `.toLowerCase()` or a template literal. A constant number reads the key JavaScript writes for it. A plain object has fields of its prototype besides its own (`toString`, `constructor`, `__proto__`), so a key typed `string` could name one of them, which the server does not have, and a key typed `number` has no members to match. Type the key as a union of literals (`"sm" | "md" | "lg"`) or an `enum`, or pass the value as a prop. See [`props`](crate::guide::props#lookup-tables).

## FV0223

Constant object read by a key that may be absent.

A constant object read by a key that may be `undefined` or `null` (`PAD[size]` with `size?: Size`) reads the field `"undefined"` or `"null"` in JavaScript, a key the object almost never has. Narrow the key with `v-if` first, or give it a default (`withDefaults`, or `PAD[size ?? "md"]`).

## FV0224

Field read of a constant that may be `undefined`.

A constant object read by a key (`ICONS[kind]`) is `undefined` for the members it lacks, and reading a field of it (`ICONS[kind].label`) then throws in JavaScript. The message names the members that lack the key. Read the field with `?.` (`ICONS[kind]?.label`), or narrow the read with `v-if="ICONS[kind]"` first.

## FV0225

Constant read by a key whose values differ in type.

A constant object read by a key compiles to one `match`, whose arms have one Rust type. Its values for the key's members must be strings, numbers (integers and fractions together), booleans or lists of one of them, of one type for every member, or objects read on by field. A string for one member and a number for another, or `null` for some and `undefined` for others, are refused. Give every member a value of one type.

## FV0226

Constant object without a key that names a field of every object.

A constant object read by a key whose union has a member the object lacks reads `undefined` for it, except for a member named like a field every object inherits (`toString`, `constructor`, `valueOf`, `hasOwnProperty`): JavaScript reads `Object.prototype`'s function for it, which the server does not have. Add the member to the object.

## FV0227

Constant `Map` read other than by `.get()` or `.has()`.

A constant `new Map([[key, value], …])`, its keys strings or integers, is evaluated when the component is compiled, and the server reads it with `.get(key)`, `undefined` for a key it lacks, and `.has(key)`, by a string or an integer that is present. Its size, its iterators and the map itself as a value are refused: read it by key, or use a constant object.

## FV0228

Constant object's value outside the union its type gives.

A constant object typed with a union of string literals for its values (`const NEXT: Record<Tone, Tone> = { … }`) holds that union's Rust enum when it is read by a key, so a value reaches a prop of the union as its variant. A string value outside the union has no variant, and TypeScript refuses it too. Give each value one of the union's members, or widen the type of the values. See [`props`](crate::guide::props#lookup-tables).

# Props and types: FV03xx

See [`props`](crate::guide::props).

## FV0301

`generic` that is not a list of type parameters.

The `generic` attribute of `<script setup>` is read as the type parameters of a TypeScript type, and text that does not parse as such a list is refused. Write it as `<T extends string>` would be written between the angle brackets: `generic="T extends string"`, or several separated by commas.

## FV0302

Type parameter without a constraint.

A generic component renders each type parameter as its constraint, so `generic="T"` alone gives the server no type. Write `generic="T extends string"`.

## FV0303

Props declared at run time.

`defineProps(['title'])` and `defineProps({ title: String })` declare props by run-time values, which give the compiler no Rust type for each prop. Declare them with a type: `defineProps<{ title: string }>()`, with `withDefaults` for defaults. See [`props`](crate::guide::props).

## FV0304

Props type the compiler does not resolve.

The props' Rust struct is built from the type `defineProps` names: a type literal (`defineProps<{ count: number }>()`), an interface or object type alias the component declares or imports from a `.ts` file, an interface that extends such types, or an intersection of them (`Base & { count: number }`), each prop declared once. A type built with `Partial`, `Pick`, `Omit` or another generic type, and an interface of a `.ts` file that extends another, are refused. Write the fields out in such a type, or declare them in place.

## FV0305

`defineModel` without a type.

`defineModel()` adds a prop to the component, and without a type parameter the compiler has no Rust type for it. Write the type: `defineModel<string>()`, or `defineModel<string>("title")` for a named model.

## FV0306

`defineModel` of a nullable type that is not required.

A model that is not `required` may be left out by the parent, which makes it `undefined`, and a `T | null` model may also be `null`. Its Rust type is an `Option`, whose `None` cannot stand for both, as `=== null` and the props sent to the client would need. Declare it `defineModel<T>()`, or pass `{ required: true }`. See [`props`](crate::guide::props#nullable-props).

## FV0307

Default for a nullable prop.

Vue uses a prop's default only when the prop is absent (`undefined`). A prop typed `T | null` is an `Option` in Rust, which has no state for absent apart from `null`, so the server could not tell when the default applies. Fall back in the template instead: `{{ props.label ?? "None" }}`.

## FV0308

Unknown type.

The generated Rust names a type (an interface, or an object type built from a constant) whose declaration the compiler cannot find when it writes the module. Every type a prop, a field or a constant names is resolved, or refused with its own code, before any module is written, so this points at a case the compiler missed: please report it with the components and `.ts` files that caused it.

## FV0309

Type that is only `undefined`.

A value the generated Rust must hold has a type with no Rust form, such as one that is only `undefined`. Props, fields and setup values of such a type are refused with their own codes before any module is written, so this points at a case the compiler missed: please report it with the component that caused it.

## FV0310

Object type written in place.

Each object in a prop's type becomes a named Rust struct. An object type written in place as a field's type, alone, in a list, optional or as a `Record`'s value (`user: { name: string }`), is named after the type and the field that hold it (`CardUser`); one written elsewhere, such as in a union of two objects or as a type argument, has no name to give it, and neither has one whose name the component already gives another type. Declare it as an interface (`interface User { name: string }`) and name that, or write `{ [key: string]: T }` for a dictionary.

## FV0311

Type that may be both `null` and `undefined`.

A Rust `Option` holds one kind of nothing, where JavaScript has two. Declare `T | null` or `x?: T`, never both. See [`props`](crate::guide::props#nullable-props).

## FV0312

Union of different types.

A Rust value has one type, so a union of types that are not the same, such as `string | number` or `User | Group`, has none. A union of string literals (`"a" | "b"`) is a `string`, and `T | null` or `T | undefined` is an `Option<T>`. Pick one type, or pass two props.

## FV0313

`Record` not keyed by `string`.

A `Record` keyed by `string` is a `ferrovue::props::Record` in Rust. One keyed by a union of string literals that are names (`Record<Side, string>`), as a field's type, is a struct with a field for each, as a mapped type `{ [K in Side]: string }` is. `Record<number, T>` and a union whose literals are not names are refused. Key it by `string`, or declare an interface with the fields.

## FV0314

Type alias that refers to itself.

The compiler translates a type alias by translating the type it stands for, and an alias that reaches itself (`type Tree = { children: Tree[] }`, or through other aliases) would never end. Declare the recursive type as an interface, which becomes a Rust struct that may name itself.

## FV0315

Unsupported named type.

A type is translated when it is a primitive, a list, a `Record`, `Date`, an interface or alias declared in the component, or a type imported from a `.ts` file in the project. A name the compiler cannot find among those, such as a type from a package or a utility type like `Partial<T>`, has no Rust type. Declare it as an interface in the component, or import it from a `.ts` file. See [`props`](crate::guide::props).

## FV0316

Unsupported type.

A prop's type is translated from strings, numbers, booleans, lists, `Record`s, `Date`, literals, unions of one type with `null` or `undefined`, and named types. An indexed type reads a field of an interface by its name (`Card["size"]`), and a mapped type over a union of string literals that are names, written as a field's type, is a struct with a field for each. Other TypeScript types, such as tuples, intersections, function types, `any`, `unknown` and `keyof`, have no Rust type; the message names the one met. A tuple's items reach the browser as an array, which a Rust struct would write as an object. Write the type as one of those: a tuple as an interface with a field for each part, or a list of such objects. See [`props`](crate::guide::props).

## FV0317

`Record` of unsupported values.

A `Record`'s values must be strings, numbers, booleans, `Date`s, objects with a declared interface, or lists of those other than `Date`s. Values that may be absent or `null`, lists of `Date`s, HTML and nested `Record`s are refused. Wrap the value in an interface, or compute the map in Rust and pass a plainer one as a prop.

## FV0318

Interface named as a Rust type.

Each interface becomes a Rust struct of the same name in the generated module, where `Option`, `Vec`, `String`, `Box`, `Result`, `Cow`, `Default`, `Slots` and their kin already name types the code uses. An interface with one of those names would hide them. Rename it.

## FV0319

Type declared in two files.

Types from `.ts` files are written into one Rust module, `types.rs`, where each name can be declared once. When two files the server renders from declare a type of the same name, the message names both. Rename one, or import it from a single file.

## FV0320

Interface with members other than plain named fields.

An interface becomes a Rust struct, which holds named fields. Methods, index signatures, call signatures and fields with a computed or quoted key (`"data-id": string`) are refused. Keep the interface to fields such as `name: string`, and a dictionary as `Record<string, T>`.

## FV0321

Optional field of a nullable type.

A field written `x?: T | null` may be absent, which is `undefined`, or `null`. Its Rust type is an `Option`, whose `None` cannot be both, as `=== null` and the props sent to the client would need. Declare it `x: T | null` or `x?: T`. See [`props`](crate::guide::props#nullable-props).

## FV0322

Prop default that is not a literal.

A default in `withDefaults` becomes a Rust value written into the generated code, so it must be a literal of the prop's type: a string, a whole number, `true` or `false`, or `() => []` for a list, and for a union of string literals one of its members. A computed value, a constant, a float default and an object are refused. Give the prop no default and fall back in the template with `??`, or compute the value in Rust and pass it.

## FV0323

Literal of a union that gives its enum variant no name.

A union of string literals is a Rust enum with a variant for each literal, named from the literal's letters and digits in PascalCase (`"x-large"` is `XLarge`, `"2xl"` is `V2xl`, `""` is `Empty`). A literal with no ASCII letter or digit (`"-"`, `"+"`, `"é"`) leaves the variant nameless. Use literals with a letter or a digit, or type the prop `string`.

## FV0324

Two literals of a union that give their enum one variant name.

Each literal of a union of string literals names a variant of its Rust enum from its letters and digits, so literals that differ only in case or punctuation (`"md"` and `"MD"`, `"a-b"` and `"a_b"`) would be one variant, as would two members of an `enum` that hold one value. Make the literals differ in their letters or digits.

## FV0325

Enum of a union named as another type of its module.

A union of string literals is a Rust enum named after its `type` alias or `enum`, or, written in place, after its component or interface and field (`size` in `Button.vue` is `ButtonSize`). Another type of the module it is written to, a struct, a slot's types, an enum of another union or one of Rust's own types, has that name. Name the union with a `type` alias of its own, or rename the other type.

## FV0326

Field with no type.

A prop or a field of an interface becomes a Rust field, whose type is translated from its TypeScript type. A field written with no type (`defineProps<{ tag }>()`, `interface Row { id }`) has no Rust type. Give the field a type, as `tag: string`. See [`props`](crate::guide::props).

## FV0327

Props of a type Vue's compiler cannot resolve.

Vue reads the props of `defineProps<P>()` from the type itself, and its compiler reads a type imported from a `.ts` file by a relative path (`import type { P } from "./p"`). A type imported through an alias (`@/types`), which it resolves only with TypeScript's own module resolution, and the `Props` of another `.vue` file are refused. Import the type by a relative path, move it into a `.ts` file both components import, or declare the props in the component. See [`props`](crate::guide::props#props-from-a-ts-file).

## FV0328

Prop named with a leading `$`.

Vue keeps the names that start with `$` for its own properties: it warns that a prop named so is invalid, leaves it out of the component's props and renders what a parent gives it as an attribute. Rename the prop without the leading `$`; a prop may hold `$` later in its name (`price$`), and the fields of its interfaces anywhere.

## FV0329

`unions` entry for an alias that is not a union of string literals.

`unions` in `ferrovue.config.json` names the application's own Rust enum for a `type` alias or a string `enum` that is a union of two or more string literals, whose variants generated code names. An alias of another type (`string`, a single literal, `1 | 2 | 3`, `"sm" | string`, an object) has no such variants. Remove the alias from `unions`, or declare it as a union of string literals. See [`props`](crate::guide::props#unions-mapped-to-existing-enums).

## FV0330

Two unions of one name that `unions` names one Rust enum for.

`unions` in `ferrovue.config.json` maps a union by the name of its `type` alias, so every alias of that name, in every `.ts` file and component, is the one Rust enum it names. Two aliases of that name with other members would need two sets of variants. Give the two unions the same members, or rename one of them. See [`props`](crate::guide::props#unions-mapped-to-existing-enums).

# Templates and attributes: FV04xx

See [`generated_code`](crate::guide::generated_code).

## FV0401

Interpolation of a value that is not a string, a number or a boolean.

`{{ }}` writes a string, a number or a boolean, as Vue's `toDisplayString` does for those. A list, an object, a `Record` or a `Date` would be written as Vue's JSON or `String()` of it, which the server does not reproduce; the message names the type. Interpolate a field of it, `.join(", ")` a list, or format a date with `.toISOString()`.

## FV0402

Attribute value of an unsupported type.

An attribute's value is written as Vue writes a string, a number or a boolean, and a value of another type has no such form on the server. Bind a field or a string built from the value.

## FV0403

Attribute bound to a value Vue's server leaves out.

Vue's server renderer leaves out an attribute bound to a list, an object or a `route.query` value, and hydration then sets it to the value's `String()` without reporting a mismatch. Join a list (`.join(",")`) or narrow a query value to one string.

## FV0404

Unsafe attribute name.

Vue's server renderer skips an attribute whose name holds `>`, `/`, `=`, `"`, `'`, a space or other whitespace, and ferrovue refuses such a name when compiling, so no attribute name can break out of its tag. Rename the attribute. See [`security`](crate::guide::security).

## FV0405

Custom directive not listed in `clientDirectives`.

A custom directive's `getSSRProps` may add attributes on the server, which ferrovue does not run. List a directive that adds none in `clientDirectives`.

## FV0406

`$attrs` on a root that takes scope ids.

A component rendered as the root of one that receives scope ids from a parent's `<style scoped>` gets those ids among its attributes. Bound with `v-bind="$attrs"`, they would be written as attributes a second time. Let the attributes fall through to the root element, or put the component inside an element so it is not the root.

## FV0407

Attributes that are not an object literal.

Attribute names come from the template alone, so `v-bind` takes an object literal (`v-bind="{ id: props.id }"`) or `$attrs`. An object from a variable, a prop or a function could hold any key. Write its attributes out in the template. See [`security`](crate::guide::security).

## FV0408

Computed or spread key in an attribute object.

An attribute object's keys are its attribute names, so a computed key (`{ [name]: value }`), a dynamic argument (`:[name]`) and a spread (`{ ...attrs }`) would name attributes at run time. Write each attribute by its name. See [`security`](crate::guide::security).

## FV0409

`className` bound in place of `class`.

Vue renders a `className` key by a rule of its own, which the server does not reproduce. Bind `class`.

## FV0410

Merged attributes that are not object literals.

When `v-bind="obj"` stands beside other attributes, Vue merges them, and the merged parts must be object literals or `$attrs` so every attribute name is known when compiling. Write the object's attributes out in the template. See [`security`](crate::guide::security).

## FV0411

Class merged with a string that may repeat the class before it.

Vue merges two classes by joining them, and writes a class once when it equals the one before it. A string class that may equal the class merged before it, unless both are string literals, would depend on that test at run time. Bind an array: `:class="[a, b]"`.

## FV0412

Fallthrough attribute of an unsupported type.

A value given to an attribute that may fall through to a child, through `$attrs` or a component's root, is a string, a number, a boolean, or one of those that may be absent. A list, an object or a `Date` has no attribute form the server writes. Bind a string built from it, or declare a prop to take it.

## FV0413

`v-model` comparing values of types it cannot compare.

`v-model` on a checkbox, a radio button or a `<select>` marks the option whose value is loosely equal to the model, which the server reproduces between two strings. Other pairs of types follow JavaScript's loose equality, which the server does not. Bind string values and a string model, or bind `:checked` or `:selected` yourself.

## FV0414

`v-model` over an array.

`v-model` of a list on a checkbox or a multiple `<select>` tests whether the list holds each option's value by loose equality, which the server does not reproduce. Bind `:checked` or `:selected` yourself, with `.includes()` on a list of strings.

## FV0415

Value read from `$attrs`.

`$attrs` holds whatever attributes a parent passes, so a value read from it (`$attrs.title`, `attrs.id`) has no type the compiler knows. Bind it whole with `v-bind="$attrs"`, or declare the attribute as a prop.

## FV0416

Root `<Transition>` or `<KeepAlive>` around `v-if` that is given attributes.

When a component's root is a `<Transition>` or `<KeepAlive>` around a `v-if`, `v-else` or `v-for` and a parent passes it attributes, Vue's server drops them where its client puts them on the element, and hydration mismatches. Set `inheritAttrs: false` and bind `$attrs` on the element inside.

## FV0417

Attribute name chosen at run time.

An attribute's name is taken from the template, so the server knows every name when compiling. A name computed as the page renders is refused. Write each attribute by its name. See [`security`](crate::guide::security).

## FV0418

`<component :is>` over a value that is not a closed set.

`<component :is>` compiles to a `match` over its choices, so each one must be known when compiling: an imported component, an HTML element's name, a `computed` or `?:` choosing among them, a prop or a `defineModel` typed as a union of string literals, or an object of imported components read by such a prop. A `string`, a `Component` or a value from elsewhere could be anything.

## FV0419

`<component :is>` naming something other than an HTML element.

A string `<component :is>` chooses names an HTML element the server writes. A name that is not an HTML element (a custom element or a misspelling), `<textarea>`, `<template>` and `<slot>`, which Vue renders by rules of their own, and the component's own name, which Vue resolves to the component itself, are refused. Name another HTML element, or bind an imported component.

## FV0420

`<component :is>` over a prop that may be absent.

When the prop `<component :is>` reads is absent, Vue renders `<!---->` or fails, so the server has no element to choose. Make the prop required, or give it a default with `withDefaults`.

## FV0421

`<component :is>` reading a key its object does not have.

`<component :is>` over an object of components (`:is="icons[props.kind]"`) compiles to a `match` over the keys the prop may take. A key the object lacks finds no component, where Vue renders `<!---->`. Add the key to the object, or remove it from the prop's type.

## FV0422

`v-html` or `v-text` on `<component :is>`.

On an element `<component :is>` chooses, Vue's server renders `v-html` and `v-text` as an empty element, which hydration then fills, so the server's HTML would differ from the page. Put the content inside the element: `<component :is="tag">{{ text }}</component>`.

## FV0423

`v-show`, or `v-model` on `<select>`, in content rendered from virtual nodes.

Inside an element `<component :is>` chooses, in the slot content such an element renders, and inside a `<RouterLink>`, Vue's server renders from virtual nodes, where `v-show` writes no `style` while it shows and `v-model` on a `<select>` marks no option `selected`. Bind `:style` or `:selected` yourself.

## FV0424

`<textarea>` or `<input v-model>` at the root, or given merged attributes.

Vue's server renderer reads a `<textarea>`'s content, and an `<input v-model>`'s `type` and `value`, from the attributes it merges into the element: those passed to the component, when the element is its root, and those of a `v-bind` of an object, an attribute named at run time or a custom directive. The compiler translates a root `<textarea>`, and a root `<input v-model>` of a literal `type` other than `radio` (a checkbox with a boolean model), where no parent passes `value` or `type`; it refuses the rest. Pass such a value as a prop, wrap the control in an element, such as a `<div>`, which then takes the attributes passed to the component, and bind each attribute of the control by its name. See [`generated_code`](crate::guide::generated_code#fallthrough-attributes).

## FV0425

Element with no content given a custom directive and attributes that may hold its content.

Vue's server renderer writes an element with no content and a custom directive with the `textContent` or `innerHTML` among the attributes it merges into the element: those passed to the component, when the element is its root, those of a `v-bind` of an object or an attribute named at run time, and a bound `textContent` or `innerHTML`. The compiler does not translate that reading. Wrap a root element in another element, such as a `<div>`, which then takes the attributes passed to the component, bind each attribute by its name, and write the content inside the element.

# Child components: FV05xx

See [`generated_code`](crate::guide::generated_code).

## FV0501

Child component that is not among the compiled components.

A child component is rendered by calling its generated Rust module, so it must be a `.vue` file in the components directory that ferrovue compiles. A component imported from a library, from `node_modules` or from outside that directory has no module to call. Move the file into the components directory, or render it with a function of your own named under `twins` in `ferrovue.config.json`. See [`errors_and_limits`](crate::guide::errors_and_limits#rust-twins).

## FV0502

Fallthrough attribute that would reach a child's prop.

An attribute a component is passed falls through to its root, and when the root is another component that declares a prop of that name, Vue hands the attribute to that prop. An attribute has no declared type, so the server cannot fill the child's typed prop with it. Declare the name as a prop of the component and pass it on to the child explicitly, or give the child's prop another name. See [`generated_code`](crate::guide::generated_code#fallthrough-attributes).

## FV0503

Child props that are not an object literal.

The compiler fills each prop of the child's `Props` from a key it can see when compiling, so the props a parent passes are attributes, an object literal (`v-bind="{ title: t }"`), or `v-bind` of a value typed as the child's own `Props`. An object built elsewhere could hold any keys. Bind each prop by name, or type the value as the child's `Props` (`import type { Props } from "./UserCard.vue"`).

## FV0504

Computed or spread key in child props.

Each key in the props given to a child must name a prop or an attribute when compiling. A computed key (`{ [name]: value }`), a spread and a method in the object could name any of them. Write each prop under its own name.

## FV0505

Attribute named by an integer.

JavaScript puts an object's keys that are integers before its other keys, in ascending order, so Vue writes an attribute named `0` or `42` ahead of those written before it. Give the attribute a name that is not an integer, such as `data-0`.

## FV0506

Required prop not passed.

A prop declared without `?` is a field of the child's Rust `Props` with no default, so the server has no value to give it. Vue would warn and render it as `undefined`. Pass the prop, or declare it optional (`title?: string`).

## FV0507

Required nullable prop not passed.

A nullable prop (`x: T | null`) left out is `undefined` in Vue, a value its Rust `Option` holds only as `null`, so the page and the server would disagree. Pass `null` for none, or declare the prop optional (`x?: T`). See [`props`](crate::guide::props#nullable-props).

## FV0508

Attributes passed to a child that takes none.

Before compiling, ferrovue gathers from every parent's template the attributes each component may be passed beyond its props. A child found to take none has a `render` without the attributes, so a call that hands it some has nowhere to put them. The two readings come from the same templates, so this points at a case the compiler missed: please report it with the components that caused it.

## FV0509

String prop given a value that is not a string.

A prop typed `string` is a Rust string, and Vue would hand the child a number or a boolean as it is, so the child would read another type than it declares (a `.length`, a comparison). Convert the value where it is passed (`String(count)`, or a template literal), or type the prop as the value is.

## FV0510

One type declared separately by parent and child.

Each component's Rust module holds its own structs, so an interface declared in the parent and one of the same name declared in the child are two Rust types, even when their fields match. Declare the interface once in a `.ts` file and import it in both components.

## FV0511

Prop given a value of another type.

The prop's Rust type cannot hold the value, and Vue would hand it to the child as it is, so the child would read another type than it declares. The message names both types. Pass a value of the prop's type, convert it where it is passed, or change the prop's declared type.

## FV0512

Type imported from a component that is not compiled.

A type imported from a `.vue` file, as `import type { Props } from "./UserCard.vue"` or an interface the component declares, names a Rust type of that component's generated module, which exists only for a component ferrovue compiles. Move the component into the components directory, or declare the type in a `.ts` file and import it from there.

## FV0513

Component resolved by name that is not imported.

A tag the template compiles to `resolveComponent("UserCard")` is a component Vue looks up in the app's registry when it renders, which the server does not have. Import the component in `<script setup>`, or, for a library component, name a function that renders it under `twins` in `ferrovue.config.json`, which a template may use registered globally. See [`errors_and_limits`](crate::guide::errors_and_limits#rust-twins).

## FV0514

Listener of unknown name given to a child with a prop named like a listener.

Vue hands a listener whose name matches a declared prop (`onSelect` for `@select`) to that prop. With `v-on="handlers"` or `@[event]`, the name is not known when compiling, so the compiler cannot tell whether it fills the child's prop named like a listener. Write the listener with a static name (`@select="…"`).

## FV0515

Prop of a union of string literals given a value outside it.

A child's prop typed as a union of string literals is a Rust enum, which holds its members alone. The value passed must be one of them: a literal of the union, a value of the same union or of one whose members it holds, or a string the compiler knows is among them (a `?:` of members, a `computed` typed as the union, a value of a wider union narrowed to the members by `===`, `!==`, its truth or `||`, as `x || undefined` and `x === "" ? undefined : x` narrow `Tone | ""`). A literal outside the union, a value of a wider union that may still hold another member, or a value typed `string`, is refused, as TypeScript refuses it. Pass a member, narrow the value to the members, or type it as the union.

## FV0516

Prop named like a listener given twice in merged props.

Vue joins a child's props with `mergeProps` when the child is a component's root, or is given `v-bind` of an object or `v-on` of an object beside other props. `mergeProps` treats a key that starts with `on` and a character other than a lowercase letter (`on1`, `onSale`, `on-sale`) as a listener, and puts two values given under it into a list, which the child's typed prop cannot hold. Give the prop once.

## FV0517

Prop named like a listener that merged props may leave out.

Vue joins a child's props with `mergeProps` when the child is a component's root, or is given `v-bind` of an object or `v-on` of an object beside other props. `mergeProps` treats a key that starts with `on` and a character other than a lowercase letter (`on1`, `onSale`, `on-sale`) as a listener, and leaves it out when its value is falsy (`0`, `NaN`, `""`, `false`), so the child takes the prop's default. ferrovue does the same for an optional prop. A required prop left out is `undefined` in the child, which its Rust type cannot hold, and the falsy value of a Rust twin's prop or of `TrustedHtml` is not known when compiling. Give a required prop a value that is never falsy, make it optional, or give the prop a name that does not start with `on`.

## FV0518

String outside a union where the render needs the union's enum.

A value typed as a union of string literals that the Rust caller holds as a string, such as a value of a `Record<string, Size>`, a store's state or a prop of a single literal, is handed to a child's prop or an object's field whose Rust type is the union's enum. The string is parsed as the component renders, and one outside the union is refused there, where Vue would write the string itself. A generated `try_render` returns it as a `ferrovue::render::Refused`, with the component and the line and column of the expression, so a server can answer `400 Bad Request`; `render` panics with its message. See [`errors_and_limits`](crate::guide::errors_and_limits#refused-at-render-time). Check the value before rendering. See [`props`](crate::guide::props#unions-of-string-literals).

# Expressions: FV06xx

## FV0601

Name or function not available on the server.

The template reads or calls a name the server has no value for: a function or value imported from a `.ts` module, which ferrovue does not run, or a name nothing declares. The server renders only what it can translate to Rust: JavaScript's built-ins, constants the compiler evaluates, and helpers. Give a function a Rust twin under `helpers.functions` in `ferrovue.config.json` and import it from the module `helpers.module` names; export a value as a constant the compiler evaluates (`export const LIMIT = 10`); or compute the value in Rust and pass it as a prop.

## FV0602

Unsupported method.

The server renders a method only where ferrovue translates it to Rust for the value's type, and the method named is not among them for this value (or is given arguments it does not take). Call a helper with a Rust twin under `helpers.functions` in `ferrovue.config.json`, or compute the value in Rust and pass it as a prop. See [`errors_and_limits`](crate::guide::errors_and_limits#helpers).

## FV0603

Unsupported call.

A template calls JavaScript's built-ins, the methods the compiler translates and helpers with Rust twins. Any other call, such as of a function passed as a prop, of a value a call returned or of an expression in parentheses, has no Rust to run. Move the function into the helpers module with a Rust twin under `helpers.functions`, or compute the value in Rust and pass it as a prop. See [`errors_and_limits`](crate::guide::errors_and_limits#helpers).

## FV0604

Field read on a value that is not an object, or that may be absent.

A field is read from an object whose type declares it. A value that may be absent would throw in JavaScript when it is, and a string, a number or a list has no such field. Narrow an optional value with `v-if` first, or read it with `?.`.

## FV0605

Field the type does not have.

The interface the value is typed by declares no field of that name, so its Rust struct has none, where JavaScript would read `undefined`. Correct the name, or declare the field in the interface.

## FV0606

Value that may be absent where its target cannot take it as it is.

Vue hands a value to a prop or a function as it is, and a Rust `Option` holds one kind of nothing, so a value that may be `undefined` given where `T | null` is taken (or `null` where `x?: T` is) would reach it as the other kind, and one that may be absent given where a present value is taken has nothing to give. Write `?? null` or `?? undefined` after it, as the message says, or narrow it with `v-if` first. See [`props`](crate::guide::props#nullable-props).

## FV0607

Value of an unexpected type.

A function's parameter has one Rust type, and JavaScript would pass a value of another type as it is. The message names both types. Convert the value first (`String(x)`, `Number(x)`), or pass one of the type the function takes.

## FV0608

`+` between unsupported types.

`+` joins a string to a string or a number, or adds two numbers. Of any other operand JavaScript first converts it by its own rules (`true` to `"true"`, a list to its items joined by commas, an object to `"[object Object]"`), which the server does not reproduce. Convert the operand explicitly first, as with `String(flag)` or `tags.join(", ")`.

## FV0609

Comparison between unsupported or absent values.

`-`, `*`, `/` and `%` take two numbers, and `<`, `<=`, `>` and `>=` two numbers, two strings or two dates, each present. Of other operands JavaScript converts them first (`undefined` to `NaN`, `null` to `0`, a string to a number), which the server does not reproduce. Narrow an optional value with `v-if` first, or convert it with `Number()`.

## FV0610

Hole in an array literal.

An array literal with a hole (`[a, , b]`) is a sparse array, whose hole `.map()` and `.filter()` skip and `.join()` writes as empty, and a Rust list has no such item. Write every item.

## FV0611

Array literal of different types.

A Rust list holds items of one type, and an array literal in a template holds strings, numbers or booleans, all of one type (integers beside a `Float` are held as `Float`s, and items that may be absent only where `.filter(Boolean)` removes them). Convert the items to one type (`String(n)`), or build a list of objects in Rust and pass it as a prop.

## FV0612

Computed member access.

`[…]` reads an item of a list by an integer index. On an object, a string or a value of another type, a key computed as the page renders could name any field, which a Rust struct cannot look up. Read a field by its name (`user.name`), and a string's character with `.at(i)`.

## FV0613

Value set up in a way the server cannot evaluate.

The template reads a name setup binds, and the server has no value for it: a function read as a value where it is not called (`{{ format }}`, `:fn="format"`), a value destructured from something the server does not have, a `let` with no initial value, or a binding that is not `ref(…)`, `computed(…)` or a plain expression. A `computed` or setup expression the compiler refuses is reported with the refusal's own code, at the construct refused, and where the template reads it. Such a name may be used freely from event handlers, which the server drops. Call the function where its value is needed, write the value as `ref(…)`, `computed(() => …)` or an expression, or compute it in Rust and pass it as a prop.

## FV0614

Logical operator between values that are not booleans.

`&&` and `||` give one of their operands in JavaScript, so `count && label` renders `0` when `count` is `0`, and the server holds the result as a Rust `bool`. `&&` takes two booleans, as `||` does outside the cases FV0617 lists. Write a comparison (`count > 0 && …`), or choose with `?:` (`count ? label : ""`).

## FV0615

`??` falling back to a computed list.

`a ?? b` falls back to a list held as it is, and a list `.filter()`, `.map()` or a spread computes is built as the page renders. Fall back to `[]`, or choose with `?:` (`a !== undefined ? a : list.filter(…)`), whose branches may compute lists.

## FV0616

`??` between different types.

`a ?? b` gives either operand, so the two must have one Rust type: an optional value falls back to a value of its own type (a number to a number of either kind). Convert the fallback (`String(n)`), or render each case in its own element with `v-if` and `v-else`.

## FV0617

`||` between unsupported types.

`||` gives its first operand that is truthy, of whatever type, and the server holds the result in one Rust type. It is supported between two booleans, two strings, two numbers of one kind, before `undefined`, after a `Date`, and after an optional string, number or boolean read by its name or a field, before a value of its type. Convert one operand so both share a type, or choose with `?:`.

## FV0618

Unsupported unary operator.

A template may use `!`, `-` of a number and `typeof`. Unary `+` converts its operand by JavaScript's rules, `~` works on a 32-bit integer, and `void` and `delete` have no value to render. Write `Number(x)` for `+x`, and compute any other in Rust and pass it as a prop.

## FV0619

`==` or `!=` with anything but `null` or `undefined`.

`==` and `!=` convert their operands before comparing (`"1" == 1`, `0 == ""` and `null == 0` follow JavaScript's own rules), which the server does not reproduce. The one use they keep is `x == null`, which tests for both `null` and `undefined`. Use `===` and `!==`.

## FV0620

Loose test against `undefined` of a value of a plugin's type.

A value whose type a plugin provides, such as a `route.query` value, may be `null` (`?q` with no `=`) as well as `undefined`, and a loose test would treat the two alike where the plugin tells them apart. Compare with `=== undefined` or `!== undefined`, or test `typeof route.query.q === "string"`. See [`routing`](crate::guide::routing).

## FV0621

Comparison of a plugin's value with `null` or `undefined`.

A value whose type a plugin provides (a `Date`, a `route.query` value, a CSS module) is compared with `null` or `undefined` only as the plugin supports, and this comparison is not among them. Test a query value with `=== undefined` or `typeof route.query.q === "string"`; a `Date` or a CSS module that is present is never `null` or `undefined`, and an optional one is tested as any optional value is.

## FV0622

`===` between different types.

`===` between values of different types is always `false`, and between objects or lists it compares their identity, which the server's copies of them do not have. Compare values of one type: convert with `String()` or `Number()`, compare fields of objects, or a list's `.length`.

## FV0623

Branches of `?:` of different types.

`?:` gives either branch. Where the result is only written out, in `{{ }}`, a string-valued attribute or a template literal, each branch is written as JavaScript writes it, so the branches may differ in type. Anywhere else the server holds the result in one Rust type, so the branches are of one type, numbers of either kind, or one absent where the other may be. Convert a branch (`String(n)`), or render each case in its own element with `v-if` and `v-else`.

## FV0624

`new` in an expression.

`new` builds an object, and the server has a twin only for those a plugin translates, such as `new Date(…)`. Any other (`new URL(…)`, `new Set(…)`) runs JavaScript the server does not have. Compute the value in Rust and pass it as a prop.

## FV0625

Unsupported expression.

The template, a `computed`, a function or a setup expression holds a kind of expression the server does not translate, such as an arrow function used as a value, `await` inside an expression or an optional chain of a shape it does not follow; the message names it and where it is. Event handlers, which the server drops, may hold any expression. Write the value with the expressions the template supports, or compute it in Rust and pass it as a prop.

## FV0626

Strict test of a value that may be `null` or `undefined`.

A value that may be either `null` or `undefined`, such as `a?.b` where `b` is `T | null`, is held in a Rust `Option`, which cannot tell the two apart, so `=== null` and `=== undefined` of it cannot be answered. Test both at once with `== null` or `!= null`. See [`props`](crate::guide::props#nullable-props).

## FV0627

Strict test against the absence a value cannot have.

A nullable value (`T | null`) is never `undefined`, and an optional one (`x?: T`) is never `null`, so the test is always `false` (or `true` with `!==`) in JavaScript and most likely a mistake. Compare a nullable value with `null` and an optional one with `undefined`, as the message says. See [`props`](crate::guide::props#nullable-props).

## FV0628

`as` or `satisfies` stating a type the value does not have.

`as` and `satisfies` change nothing as the page renders: the value keeps the type it has, which is the one the server holds. A statement of another type would have the server treat it as a value it is not. Write the value with the type it has, convert it (`String(x)`, `Number(x)`), or narrow an optional one with `v-if`; `[] as string[]` types an empty array literal.

## FV0629

Optional call `?.()`.

The functions a template may call, JavaScript's built-ins and helpers with Rust twins, are always present, and a function that may be absent, such as an optional prop, has no Rust to run. Write the call without `?.`.

## FV0630

`??` between a list an optional chain computes and another list.

`a?.b ?? list` falls back from a list the optional chain computes to another list, which the generated code cannot hold in one place with it. Fall back to `[]`, or choose with `?:` between the two.

## FV0631

`in` or `instanceof`.

`in` and `instanceof` read an object's keys and prototype as the page renders, which the server's typed values do not carry. Test a record's key with `Object.keys(r).includes(key)`.

## FV0632

Bitwise or shift operator.

`&`, `|`, `^`, `<<`, `>>` and `>>>` convert their operands to 32-bit integers by JavaScript's rules, wrapping and truncating them, which the server does not translate. Compute the value in Rust and pass it as a prop.

## FV0633

Part of JavaScript's own globals the server does not translate.

`JSON`, `Math`, `Number`, `String` and the other globals a template may name are translated only in part: `JSON.stringify(x)` of one value, `String(x)`, `Number(x)` and the `Number.is…()` tests, the `Math` methods and constants the [`numbers`](crate::guide::numbers) page lists, `encodeURI` and `encodeURIComponent`. The message names what the server translates of the one used.

## FV0634

Object literal whose type is not known.

The server builds an object literal as the Rust struct of the interface it is typed with, so its type comes from where it goes: a prop typed with an interface, an annotated `computed` (`computed<Card>(…)`, `computed((): Card => …)`), a function's return type or parameter, a `.map()` callback's return type or the list type it makes, an annotated `const`, or `as Card`. A literal none of these types has no struct to be built as, and one typed as a `Record` would be a dictionary the server reads from Rust. The message names where the literal is and how to give it its type. See [`script_logic`](crate::guide::script_logic#object-literals).

## FV0635

Object literal that does not match its interface.

An object literal built as a struct holds the fields of its interface: each key a field, given once, every required field given, and a computed key only where the compiler knows it (a string, a constant, an enum member). A key the interface does not declare, a method or accessor, `__proto__`, a spread of another type, and a spread after other keys, which keeps or writes over them as the object it copies holds them, are refused, and so is a string that may be outside the union of string literals a field is typed with. Write the fields out, with the spread first, and give a union field one of its members or a value typed as the union. See [`script_logic`](crate::guide::script_logic#object-literals).

## FV0636

Object literal read in place.

A value built from object literals (an object, or a list `.map()` makes of them) is held by the expression that builds it, which ends before a list method's result, an item or an optional chain read from it would be used. Give the value a `computed` of its own and call the method on that, or call `.filter()`, `.slice()` and the other methods before `.map()`. See [`script_logic`](crate::guide::script_logic#object-literals).

## FV0637

Comparison of a union of string literals with a literal outside it.

A value typed as a union of string literals is a Rust enum, and `===` or `!==` with a literal compares it with one of its variants. A literal outside the union is no variant: the comparison would always be `false` (or `true` for `!==`), and TypeScript refuses it as a comparison of types with no overlap. Compare with one of the union's members, or fix the literal's spelling.

# Strings and numbers: FV07xx

See [`strings`](crate::guide::strings).

## FV0701

`Number()` of an unsupported value.

`Number(x)` is translated for a string, read by JavaScript's grammar for numbers with `js_number`, a number and a boolean, each present. `Number()` gives `NaN` for `undefined` and `0` for `null`, and converts an object or a list through its `String()`, which the server's typed values do not reproduce. Narrow an optional value with `v-if` or give it a fallback with `??`, and read a date with `.getTime()`.

## FV0702

`parseInt()` or `parseFloat()` of a value that is not a string.

`parseInt()` and `parseFloat()` are translated for a string, with `js_parse_int` and `js_parse_float`. JavaScript converts any other argument to a string first, so `parseInt(0.0000005)` is `5`; a number needs no parsing, and an optional string takes a fallback with `??` before it is parsed. See [`strings`](crate::guide::strings).

## FV0703

`parseInt()` with a radix other than a literal 10 or 16.

`js_parse_int` reads leading digits in base 10 or 16, the radixes the server reproduces; with no radix it reads `0x` as JavaScript does. A radix from a variable or any other base is refused. Write `parseInt(s)`, `parseInt(s, 10)` or `parseInt(s, 16)`, or parse the value in Rust and pass it as a prop.

## FV0704

Unsupported `Math` method.

Of `Math`, the server translates `max`, `min`, `abs`, `round`, `floor`, `ceil`, `trunc`, `sqrt`, `sign` and `pow` of numbers that are present, and `Math.max(...xs)` and `Math.min(...xs)` of a list of numbers. Each has a twin that writes the digits JavaScript writes; another method, an optional argument or a list of other values is refused. Narrow an optional number first, or compute the value in Rust and pass it as a prop. See [`numbers`](crate::guide::numbers).

## FV0705

`.toFixed()` without a literal number of digits from 0 to 100.

`.toFixed(d)` is written by `js_to_fixed`, which needs its number of digits when compiling. JavaScript throws a `RangeError` for a count outside 0 to 100, so a count from a variable could fail on the client where the server rendered. Write the count as a literal (`price.toFixed(2)`), or none for `0`. See [`numbers`](crate::guide::numbers).

## FV0706

String that may hold half of a surrogate pair compared, searched, joined or encoded.

`slice`, `substring`, `substr`, `at`, `charAt` and `split("")` can cut a surrogate pair in half. JavaScript keeps the half where ferrovue holds U+FFFD, so two such strings may compare, search or join differently, `charCodeAt` and `codePointAt` would read U+FFFD's code, and `encodeURI` and `encodeURIComponent`, which throw a `URIError` on a half, would encode U+FFFD. See [`strings`](crate::guide::strings#halves-of-surrogate-pairs).

## FV0707

`JSON.stringify()` of an unsupported value.

`JSON.stringify(x)` is written on the server for a string, a number, a boolean, a date and a list of those, each present. JavaScript writes an object's keys in their insertion order, omits `undefined` and writes `null`, which the server's typed values do not carry. Stringify the items one at a time, give an optional value a fallback with `??`, or serialize the value in Rust and pass it as a string prop.

## FV0708

Template literal of a value it cannot write.

A template literal writes each value as `String()` does: strings, numbers and booleans, present or optional, and lists of them joined by `,`. An object writes `[object Object]`, and other values (a record, a date, a list of lists) by JavaScript rules the server does not reproduce. Write the field you mean (`` `${user.name}` ``), format a date with `.toISOString()`, or join a list's fields with `.map()` and `.join()`. See [`strings`](crate::guide::strings#numbers-from-strings-and-strings-from-values).

## FV0709

String method with the wrong number of arguments.

Each string method is translated with the number of arguments the message gives: `.includes()`, `.startsWith()`, `.endsWith()`, `.indexOf()` and `.split()` take a value and an optional position or limit, `.replace()` and `.replaceAll()` take two, `.at()` and `.repeat()` take one. JavaScript ignores extra arguments, which here most often means a mistake, and a missing one is read as `undefined`. Pass the arguments the message names.

## FV0710

Regular expression.

The server runs a subset of regular expressions, with JavaScript's matching over UTF-16 code units: a literal in `.replace()`, `.replaceAll()` (with `g`), `.split()` and `.test()`, holding characters, `.`, classes, `\d`, `\w`, `\s`, `^`, `$`, `\b`, the quantifiers `*`, `+`, `?` and `{n,m}`, and the flags `g` and `i`. Groups, alternation, backreferences, lookarounds, other flags, a regular expression held in a constant and its other methods are refused. Write the pattern within the subset, use a string pattern, or do the matching in Rust and pass the result as a prop. See [`strings`](crate::guide::strings#regular-expressions).

## FV0711

String method given a value that is not a present string.

A string method's pattern, separator or fill takes a string that is present. JavaScript converts any other value with `String()`, so `s.includes(undefined)` looks for `"undefined"`, which is seldom what is meant. Narrow an optional string with `v-if` or give it a fallback with `??`, and convert a number with `String(n)`.

## FV0712

String method given a value that is not a present number.

A string method's position, length or count takes a number, present or optional (`undefined` reads as the method's default, `null` as `0`). A value that may be `null` or `undefined` is refused, since its Rust `Option` cannot tell which. Other types JavaScript converts with `Number()`, so a string position is read as a number. Convert it yourself with `Number(s)`, or narrow the value first.

## FV0713

Function given to a string method.

`.replace()` and `.replaceAll()` with a replacement function call it for each match with the match, its groups and its offset, which the server does not run. They take a string replacement, where `$&`, `$1` and the other patterns are read as JavaScript reads them. Build the string in Rust and pass it as a prop when each match needs its own text.

## FV0714

`.repeat()` by a negative or infinite count.

`.repeat()` throws a `RangeError` for a negative count and for `Infinity`, which fails the render in Vue as well. A literal such count is refused when compiling; a count from the props that is negative or infinite is refused as the component renders: a generated `try_render` returns it as a `ferrovue::render::Refused`, with the component and the line and column of the expression, so a server can answer `400 Bad Request`; `render` panics with its message. See [`errors_and_limits`](crate::guide::errors_and_limits#refused-at-render-time). Clamp the count (`Math.max(0, n)`) before repeating.

## FV0715

Case mapping by the server's locale.

`.toLocaleUpperCase()` and `.toLocaleLowerCase()` map case by the locale of the machine running them (Turkish maps `i` to `İ`), and the server's locale need not be the reader's. Use `.toUpperCase()` and `.toLowerCase()`, which map case the same in every locale. See [`strings`](crate::guide::strings).

## FV0716

`.toPrecision()` without a literal precision from 1 to 100.

`.toPrecision(p)` is written by `js_to_precision`, which needs its precision when compiling. JavaScript throws a `RangeError` for a precision outside 1 to 100, so a precision from a variable could fail on the client where the server rendered. Write the precision as a literal (`x.toPrecision(3)`), or none for `String(x)`. See [`numbers`](crate::guide::numbers).

## FV0717

`.toExponential()` without a literal number of digits from 0 to 100.

`.toExponential(d)` is written by `js_to_exponential`, which needs its number of digits when compiling. JavaScript throws a `RangeError` for a count outside 0 to 100, so a count from a variable could fail on the client where the server rendered. Write the count as a literal, or none for as many digits as the number needs. See [`numbers`](crate::guide::numbers).

## FV0718

`isNaN()`, `isFinite()` or a `Number.is…()` test of a value that is not a number.

`Number.isNaN()`, `Number.isFinite()`, `Number.isInteger()` and `Number.isSafeInteger()` take a number, present or optional, and are `false` for any other value, which they do not convert; the global `isNaN()` and `isFinite()` convert theirs as `Number()` does and take a present number. Test a date with `Number.isNaN(d.getTime())`, and a string with `Number.isNaN(Number(s))`.

## FV0719

`Math` function engines round differently.

`Math.cbrt`, `Math.hypot`, `Math.exp`, `Math.log`, the trigonometric functions and their kin are computed by each JavaScript engine's own routine, which the specification leaves free to round differently, and Rust's do not promise V8's digits either. Compute the value in Rust and pass it as a prop.

## FV0720

`**` or `Math.pow()` other than an exact integer power known when compiling.

Engines compute powers by different routines: Node 22's V8 writes `10 ** -20` as `1.0000000000000001e-20`, Node 24's and Firefox's as `1e-20`, and above 2⁵³ they round in their own ways. The compiler works out `a ** b` and `Math.pow(a, b)` when both are known, `a` an integer and `b` a whole number from 0, with a result within ±2⁵³, which every engine gives exactly.

## FV0721

Value that may be `null` or `undefined` written as a string.

`String()`, a template literal and `.concat()` write an absent value as `undefined` or as `null`. A value typed both `null` and `undefined`, such as `x?: string | null`, is one Rust `Option`, whose `None` cannot say which to write. Give it a fallback with `??` (`` `${label ?? ""}` ``), or declare it either `T | null` or `x?: T`. See [`props`](crate::guide::props#nullable-props).

## FV0722

`typeof` the compiler cannot work out.

`typeof` gives the JavaScript type of a value the compiler has typed: a string, a number, a boolean, `undefined`, or `"object"` for `null`, a list, a record, an object and a date. A value that may be `null` (an `"object"`) or `undefined` is one Rust `Option`, which cannot tell the two apart, and some values have no type the compiler knows. Test an absent value with `== null`, or narrow it before testing its type.

## FV0723

`String()`, `.concat()` or `encodeURI…()` of a value it cannot write.

`String(x)`, `encodeURI(x)`, `encodeURIComponent(x)` and `s.concat(x)` take one value each and write it as `String()` does: strings, numbers and booleans, present or optional, and lists of them joined by `,`. An object writes `[object Object]`, and other values (a record, a date, a list of lists) by JavaScript rules the server does not reproduce. Pass the field you mean, format a date with `.toISOString()`, or build the string in Rust and pass it as a prop.

## FV0724

Integer beyond the range of `i64` where the template needs one, as it renders.

Integer arithmetic is done on doubles, as JavaScript does it, and a result written into the page is written from the double. Where the template needs the result as an integer, as a child's `number` prop, an index or the count of a `v-for` over a range, it is held as an `i64`, which stops at ±2⁶³: a result beyond that is refused as the component renders, where a cast to `i64` would change the number. A generated `try_render` returns it as a `ferrovue::render::Refused`, with the component and the line and column of the expression, so a server can answer `400 Bad Request`; `render` panics with its message. See [`errors_and_limits`](crate::guide::errors_and_limits#refused-at-render-time). Keep integer props within ±2⁵³, where JavaScript's integers are exact, or type the child's prop `Float`. See [`numbers`](crate::guide::numbers).

## FV0725

String longer than JavaScript allows, as it renders.

`.repeat()`, `.padStart()` and `.padEnd()` throw a `RangeError` for a result longer than the longest string V8 makes, 2²⁹ − 24 code units, which fails the render in Vue as well. A count or length from the props that asks for one is refused as the component renders. A generated `try_render` returns it as a `ferrovue::render::Refused`, with the component and the line and column of the expression, so a server can answer `400 Bad Request`; `render` panics with its message. See [`errors_and_limits`](crate::guide::errors_and_limits#refused-at-render-time). Limit the count or the length before rendering.

# Lists and loops: FV08xx

See [`props`](crate::guide::props).

## FV0801

`.includes()` of a value of another type than the list's.

`.includes(x)` compares with the list's items by JavaScript's equality, which is true only between values of one type (numbers whether `number` or `Float`), in a list of strings, numbers or booleans. A value of another type is never found, and objects are equal only when they are one object, which the server's copies of them are not. Look for a value of the list's own type, or test a field with `.some(x => x.id === id)`.

## FV0802

`.join()` with a separator that is not a string.

`.join(sep)` takes a string separator, or none for `,`. JavaScript converts any other separator with `String()`, so `.join(undefined)` joins with `,` and `.join(null)` with `null`. Pass a string literal or a present string, giving an optional one a fallback with `??`.

## FV0803

List method on a value that is not a list. Retired in 0.10.0: the compiler no longer raises it.

## FV0804

List method over a list of unsupported items.

List methods and reading an item by index work over lists of strings, numbers, booleans or objects (each of which may be absent when an item is read). A list of lists, of records or of dates has no item the generated iterator can hand out. Map the inner values to one of those types first, or compute the result in Rust and pass it as a prop.

## FV0805

List method given anything but an arrow function or `Boolean`.

`.filter()`, `.map()`, `.some()`, `.every()`, `.find()` and their kin take an arrow function of the item and of its index (`x => …` or `(x, i) => …`), which the compiler translates to a Rust closure, or `Boolean`. A function name, an `async` arrow or one that reads the list as a third parameter is something the server cannot inline. Write the condition as an arrow function, or move a named function to the helpers module with a Rust twin under `helpers.functions` and call it inside one (`x => isActive(x)`).

## FV0806

Arrow function with a block body. Retired in 0.10.0: the compiler no longer raises it.

## FV0807

Arrow function index that is not a plain name.

The second parameter of an arrow function given to a list method is the item's index, a number, which the compiler binds to a Rust variable. A pattern or a default there has nothing to destructure. Name it (`(x, i) => …`).

## FV0808

Defaults or nested patterns in an arrow function's item.

An arrow function's item may be destructured as an object pattern of plain names (`({ id, name }) => …`), each bound to a field. A default (`{ count = 0 }`), a nested pattern, a computed key or a rest element is refused. Destructure the plain fields and write a default with `??` in the body (`count ?? 0`).

## FV0809

Arrow function item bound by an unsupported pattern.

An arrow function's item is a name (`x => …`), or an object pattern of an object (`({ id }) => …`). An array pattern, a rest parameter, a default, or an object pattern of a list of strings or numbers is refused. Name the item and read its parts in the body.

## FV0810

`.map()` to optional or unsupported values.

`.map()` builds a list of strings, numbers, booleans or objects. A function that gives a value that may be absent, a list, a record or a date makes a list the server's generated code does not hold. Give an absent value a fallback with `??` (`x => x.label ?? ""`), or map to a field of one of those types.

## FV0811

`.slice()` with more than two arguments.

A list's `.slice()` takes a start, and an optional end, counted in items as `js_slice_items` counts them. JavaScript ignores further arguments, which here most often means a mistake. Pass one or two numbers.

## FV0812

`.slice()` of values that are not numbers.

A list's `.slice(start, end)` takes numbers, or `undefined` for its default. JavaScript converts any other value with `Number()`, so `.slice("2")` slices from 2 and `.slice(null)` from 0. Convert the value yourself with `Number()`, or narrow it first.

## FV0813

List method given more than one function.

`.filter()`, `.map()`, `.some()`, `.every()`, `.find()`, `.findIndex()`, `.findLast()` and `.findLastIndex()` take one arrow function. JavaScript passes a second argument as the function's `this`, which an arrow function ignores. Give the method one function.

## FV0814

`Object` method of a value that is not a `Record`.

`Object.keys()`, `Object.values()` and `Object.entries()` take a `Record<string, T>`, which the server holds as an ordered map of its keys. An interface, an object prop or any other value is a Rust struct, whose fields the generated code reads by name and does not walk. Type the prop as a `Record<string, T>`, or list its fields in the template.

## FV0815

`Object.values()` of a record of lists. Retired in 0.10.0: the compiler no longer raises it.

## FV0816

`[key, value]` pairs of `Object.entries()` kept or compared.

`Object.entries(r)` gives a list of `[key, value]` pairs, which the server walks: in a `v-for` (`([key, value], i) in Object.entries(r)`) and through list methods whose functions destructure each pair or read its parts (`Object.entries(r).filter(([, n]) => n > 0).map(([k]) => k)`, `pair[0]`, `pair[1]`). A method that writes or compares whole pairs is refused: `.join()`, which writes each pair as its key and value joined by `,`; `.includes()`, which compares pairs as objects and finds none; `.toSorted()` without a comparator, which orders them by that text; and `.map()` to the pairs themselves, which would keep a list of pairs as a value. Map the pairs to their keys, their values or values made of them first, and give `.toSorted()` a comparator.

## FV0817

Unsupported `Object` method.

Of `Object`, the server translates `keys`, `values` and `entries` of a `Record<string, T>`. `Object.assign()`, `Object.fromEntries()`, `Object.freeze()` and the others build or change objects, which a render does not do to the server's typed values. Compute the object in Rust and pass it as a prop.

## FV0818

`v-for` over `Object.entries()` without `[key, value]`.

A `v-for` over `Object.entries(r)` binds each pair to an array pattern of plain names, `[key, value]` or `[key]`, and an optional index after it. A single name for the pair, a default, a nested pattern or a rest element is refused, since the server holds no pair to bind. Write `([key, value], i) in Object.entries(r)`, or `(value, key, i) in r`.

## FV0819

`v-for` over an empty array literal.

A `v-for` over `[]`, or over a choice between empty array literals, walks no item, and the compiler has no item type for the loop's body. Leave the loop out, or walk a typed list (`props.items`) or `[] as Item[]`.

## FV0820

`v-for` over a value that is not a list or a number.

A `v-for` walks a list, a `Record<string, T>`, or counts from 1 to a number. Vue also walks a string's characters and any iterable, and walks nothing for `null` and `undefined`, which the server does not translate. Narrow an optional list with `v-if` or give it a fallback with `?? []`, and split a string with `.split("")` first.

## FV0821

Defaults or nested patterns in a `v-for` item.

A `v-for` item may be destructured as an object pattern of plain names (`{ id, name } in items`), each bound to a field. A default (`{ count = 0 }`), a nested pattern, a computed key or a rest element is refused. Destructure the plain fields and write a default with `??` where the value is used.

## FV0822

`v-for` item bound by an unsupported pattern.

A `v-for` item is a name (`item in items`) or an object pattern of an object (`{ id, name } in items`). An array pattern over a list, or an object pattern over a list of strings or numbers, is refused. Name the item and read its parts in the loop's body; walk a record's pairs with `([key, value], i) in Object.entries(r)`.

## FV0823

`v-for` key or index that is not a plain name.

A `v-for` over a record binds its value, its key and its index: `(value, key, i) in r`. The key is a string and the index a number, so a pattern or a default in their place has nothing to destructure. Name them.

## FV0824

List item read by an index that is not an integer.

`list[i]` reads an item by an integer index, a `number` that is present, as Rust's `get` does. A `Float` may hold a fraction, which JavaScript reads as a key no item has, and an optional index or a string is converted by JavaScript rules of its own. Use `.at(i)`, which takes any number and truncates it, or narrow the index to an integer first.

## FV0825

`.at()` of a list given anything but one number.

`.at(i)` takes one index, a number that is present, which `js_item_at` truncates and counts from the end when negative. JavaScript converts an optional index or a string with `Number()`, so `.at(undefined)` is the first item. Narrow the index with `v-if`, give it a fallback with `??`, or convert it with `Number()`.

## FV0826

`.indexOf()` or `.lastIndexOf()` given anything but one value of the list's type.

`.indexOf(x)` and `.lastIndexOf(x)` compare with `===`, which is true only between values of one type (numbers whether `number` or `Float`), in a list of strings, numbers or booleans. The server takes no position to start from, objects are equal only when they are one object, and a value of another type is found nowhere. Look for a value of the list's own type, or find an object by a field with `.findIndex(x => x.id === id)`.

## FV0827

`.concat()` of anything but lists of the same item type.

A list's `.concat()` chains lists of its own item type (numbers whether `number` or `Float`). JavaScript also appends a plain value and lists of other types, which would make a list of mixed items the server cannot hold. Pass lists of the same item type, and wrap a single value in an array literal (`.concat([x])`), or use a spread, `[...a, x]`.

## FV0828

`.reduce()` or `.reduceRight()` without an initial value.

`.reduce()` and `.reduceRight()` without an initial value start from the first item, and throw a `TypeError` on an empty list. Give an initial value after the function (`.reduce((sum, x) => sum + x.price, 0)`), which also fixes the accumulator's type. See [`strings`](crate::guide::strings#building-lists).

## FV0829

`.reduce()` or `.reduceRight()` whose accumulator changes type or is not a string, number or boolean.

The server folds a list with `js_reduce` into one Rust variable whose type is fixed when compiling, from the initial value and the function's body: a string, a number or a boolean that is present. An accumulator that is an object or a list, or a function that gives another type than its initial value, has no Rust type to hold it, and the function takes the accumulator, the item and its index as plain names. Keep the accumulator of one type, or compute an object in Rust and pass it as a prop. See [`strings`](crate::guide::strings#building-lists).

## FV0830

`.toSorted()` with a comparator of a shape the server does not order by.

With a comparator, `.toSorted()` sorts in the order JavaScript gives only for shapes the compiler can reproduce for every input: `(a, b) => a - b` and `(a, b) => a.k - b.k` over integers, and `?:` over `<`, `>`, `<=`, `>=`, `===` and `!==` of integers or strings giving literals of a consistent order. Other comparators may be inconsistent, and each engine then orders the items its own way; a `Float` key is refused, since a `NaN` makes any comparator inconsistent, and so is `localeCompare`. Sort by an integer or a string key, or sort in Rust and pass the list as a prop. See [`strings`](crate::guide::strings#building-lists).

## FV0831

`.toSorted()` without a comparator of a list of objects.

`.toSorted()` without a comparator orders the items by `String(x)`, which is `[object Object]` for every object, leaving them in their order in JavaScript, which is seldom what is meant. Give it a comparator over a field, `(a, b) => a.k - b.k` for integers or `(a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)` for strings.

## FV0832

`.sort()` or `.reverse()` of a list in place.

`.sort()` and `.reverse()` change the list they are called on, which in a render is a prop or state that every other place reading it would then see changed. Write `.toSorted()` or `.toReversed()`, or `[...list].sort(…)` and `[...list].reverse()`, which the server takes as the same.

## FV0833

Array spread of anything but lists of the same item type.

A spread in an array literal chains lists of one item type, strings, numbers, booleans or objects, with plain values of that type beside them (numbers whether `number` or `Float`). Spreading a value that is not a list (a string, a record, an optional list) or mixing item types would make a list the server cannot hold. Give an optional list a fallback with `?? []`, and keep each part to one item type.

## FV0834

`.flat()` or `.flatMap()` of a list it cannot flatten.

`.flat()` joins the inner lists of a list of lists, to the depth it is given (1 when none), and `.flatMap(f)` the lists `f` gives, keeping a value that is not a list as `.map()` would. The depth is a literal number or `Infinity`, since the server's type of the result depends on it. The flattened items are strings, numbers, booleans or objects: lists of optional values, of records or of pairs (as items, or inside the inner lists), and a function that gives only `[]`, whose items have no type, are refused. Give a literal depth, map the inner values to one of those types, or write `[] as T[]`.

# Slots: FV09xx

See [`slots`](crate::guide::slots).

## FV0901

Slots that are not an object literal.

A `v-if` or `v-for` on a `<template #name>` makes the slots a component is given depend on the data, which Vue compiles to a `createSlots()` call. Each slot is a field of the child's `Slots` struct, filled or left `None` when compiling, so the slots given must be one fixed set. Give the slot unconditionally and put the `v-if` or `v-for` inside its content.

## FV0902

Computed or spread slot name.

A dynamic slot name (`<template #[name]>`) chooses the slot as the page renders. Each slot is a field of the child's `Slots` struct, which the compiler fills by name, so the name must be written out. Give each slot by its literal name, with a `v-if` inside the content where it depends on the data.

## FV0903

Content for a slot the child does not have.

The parent gives content for a slot the child's template never renders with a `<slot>`, so the child's `Slots` struct has no field to put it in. For a twin, the slots it takes are the ones listed under its `slots` in `ferrovue.config.json`. Remove the content, fix the slot's name, or add the `<slot>` to the child.

## FV0904

Defaults or nested patterns in destructured slot props.

A slot's props reach its content as a struct, and each name the content destructures is read from one of its fields. A default (`{ text = 'x' }`), a nested pattern (`{ row: { id } }`) and a rest element are refused. Destructure plain names (`{ text, index: n }`) and write a default in the content (`text ?? 'x'`).

## FV0905

Slot props bound by an unsupported pattern.

The content of a scoped slot takes its props as one name (`v-slot="props"`) or as an object pattern (`v-slot="{ row }"`). An array pattern or another binding has no struct field to read from. Bind the props to a name or destructure them as an object.

## FV0906

Slot props taken from a slot that passes none.

The content binds slot props (`v-slot="{ v }"`) for a `<slot>` in the child that passes none, so it has nothing to bind. Vue gives such content an empty object. Drop the binding, or pass the props from the child's `<slot>`.

## FV0907

Slot read that the template does not render.

`$slots.x`, or `x` on the object `useSlots()` returns, is read for a slot this component's template does not render with a `<slot name="x">`. The component's `Slots` struct has a field only for each slot the template renders, so the server cannot tell whether the parent gave that one content. Render the slot in the template, or remove the read.

## FV0908

Slot prop or provided value of a type with no Rust type.

A value that reaches the content of a slot, or a value provided with `provide`, is held in a Rust struct field, and its type has none: a dictionary (`Record<string, T>`), a date, or another type the field has no borrowed form for. A slot prop is a string, a number, a boolean, an object, a list, or one of those that may be absent. Pass such a value, or the object that holds it.

## FV0909

Array literal as a slot prop.

A list a `<slot>` passes reaches its content as a slice borrowed from the component, and an array literal (`:list="[a, b]"`) is built during the render, with nothing to borrow it from. Pass a list the component holds, such as a prop, or compute the list in Rust and pass it as a prop.

## FV0910

Computed list as a slot prop.

A list a `<slot>` passes reaches its content as a slice borrowed from the component, and a list made in the template by `.filter()`, `.map()` and their kin is built during the render, with nothing to borrow it from. Pass a list the component holds, such as a prop, or compute the list in Rust and pass it as a prop.

## FV0911

Slot prop of an unsupported type.

A `<slot>` passes its content a string, a number, a boolean, an object or a list, each of which may be absent; each becomes a field of the slot's props struct. A value that is only `null` or `undefined`, one that may be absent in two ways, and a value of another type such as a dictionary have no such field. Pass one of those types, or the object that holds the value.

## FV0912

Slot name that is not literal.

A `<slot :name="…">` whose name is chosen as the page renders is refused. Each slot is a field of the component's `Slots` struct, named when compiling. Write each outlet with a literal `name`, and choose between them with `v-if`.

## FV0913

Slot props that are not attributes or an object literal.

A `<slot>` passes its props as attributes (`:row="r"`) or as a `v-bind` of an object literal (`v-bind="{ row: r }"`). A `v-bind` of an object held elsewhere (`v-bind="item"`) has keys the compiler cannot list, and each prop must be a field of the slot's props struct. Pass each prop as an attribute.

## FV0914

Computed or spread key in slot props.

The object a `<slot>`'s `v-bind` takes holds plain `name: value` pairs. A computed key (`[key]: v`), a spread (`...item`) or a method has a name the compiler cannot know, and each slot prop must be a field of the slot's props struct. Write each prop by its name.

## FV0915

Slot prop name that is not a plain name.

Each slot prop becomes a field of the slot's props struct, named in snake case from a JavaScript name. A key that is not a plain name (`'item.count'`, `'item-count'` in a `v-bind` object) has no such field. Name the prop in camelCase (`itemCount`).

## FV0916

Outlets of one slot that pass different props.

Every `<slot>` of one name in a template shares one props struct and one closure type, so each outlet passes the same props, of the same types. Outlets that pass different props, or where one passes props and another none, are refused. Pass the same props from every outlet, or give the outlets different names.

## FV0917

Interface named as a slot's props type.

A scoped slot's props struct is named after the slot (`<slot name="item">` gives `ItemSlotProps`), and the component already declares an interface of that name, which would be a second Rust struct with the same name. Rename the interface.

## FV0918

Slot scope id given to content that takes none.

The compiler works out beforehand which components' slot content takes the scope ids of the `<slot>` that renders it, and met a `<slot>` that passes one to content it found takes none. This points at a case the compiler misses. Please report it with the component that caused it.

## FV0919

`<slot>` with fallback content inside an element `<component :is>` chooses.

Inside an element that `<component :is>` chooses, Vue renders a slot's content as virtual nodes and decides whether to show the fallback by rules of their own. Give the fallback from the parent instead.

## FV0920

`<slot>` rendered both inside and outside an element `<component :is>` chooses.

Vue renders slot content from virtual nodes inside an element `<component :is>` chooses, and as server-rendered strings elsewhere, which can write different markup, while the parent's content is compiled once for the slot. A `<slot>` rendered in both places is refused. Render the slot in one kind of place only, such as inside `<component :is>` in every branch.

# Classes, styles and scoped styles: FV10xx

See [`scoped_styles`](crate::guide::scoped_styles).

## FV1001

Spread or method in a class object.

A class object holds `name: condition` pairs. A spread (`...classes`) or a method adds names the compiler cannot list. Write each class as its own pair, put the other object in an array beside it (`[classes, { active: on }]`), or compute the class string in Rust and pass it as a prop.

## FV1002

Computed class name that is not a string.

A computed key in a class object (`{ [name]: on }`) is the class name, and the server writes it as a string. A key of another type, such as a number, is refused, as Vue would write its `String()`. Make the key a string, or write the class names out.

## FV1003

Class name with spaces around it.

Vue writes a class object's names as they are written, so a name with spaces around it (`{ ' wide ': on }`) puts extra spaces between its neighbours, and an empty name (`{ '': on }`) an extra space. Write the name without the spaces.

## FV1004

Class binding of an unsupported type.

A class binding is a string, an array of class bindings, or an object of `name: condition` pairs, any of which may be absent. A number, a boolean, a dictionary, and a list held in a prop or setup (`string[]`) are refused; the compiler reads an array only as a literal in the template. Bind a string, an array literal, or an object of conditions.

## FV1005

`<style module>` without `cssModules` in the configuration.

Vite names a CSS module's classes by `css.modules.generateScopedName`. ferrovue computes the same names when `cssModules` in `ferrovue.config.json` is set as that option is; without it, it cannot know them.

## FV1006

`v-bind()` in CSS of a value that is not a string or a number.

Vue's server writes a variable `v-bind()` sets from a string or a number, `initial` for `null` and `undefined`, and warns of anything else.

## FV1007

Style binding of an unsupported type.

A style binding is a string, an object of `property: value` pairs, or an array of those, any of which may be absent. A number, a boolean, a list or a dictionary from elsewhere is refused, as Vue's `normalizeStyle` reads each by rules the server does not follow. Bind an object literal of properties, or a string of CSS.

## FV1008

Computed or spread key in a style object.

A style object holds plain `property: value` pairs, written in the template. A computed key (`[prop]: v`), a spread (`...base`) or a method names properties the compiler cannot list, and the server writes each property in the order Vue does. Write each property by its name, or put the other style in an array beside the object (`[base, { color: c }]`).

## FV1009

Style property named by a number or starting with `:`.

A style property named by an integer (`{ 0: 'x' }`) comes first in a JavaScript object whatever its place in the source, and a name starting with `:` is not a CSS property: Vue writes it into the attribute as it is, and its parser of style strings, which merges a static `style` with a binding, splits such a declaration at its first colon and reads it as another property. Name the property as CSS does, in camelCase or kebab-case.

## FV1010

Style array mixing a string with objects.

Vue merges a style array's objects into one, where a later property replaces an earlier one at its first place, and a string of CSS is merged as the properties it parses into. The compiler takes a string on its own, or objects and literal strings in an array; a string from elsewhere beside objects, or a value of another kind in the array, is refused. Bind the string on its own, or write its properties as an object.

## FV1011

Style property whose place depends on a condition.

When a style array sets one property in two objects, Vue writes it at the place of the first set and with the value of the last. Where the first set depends on a condition and other properties come between the two, where the property is written would depend on that condition. Set the property unconditionally in the first object (`{ color: 'inherit' }`), or set it only once.

## FV1012

Scope ids handed to a component whose render does not take them.

The compiler works out beforehand which components' renders take scope ids from their parent (a scoped style, attributes that fall through, or slot content), and met a call that hands ids to a component it found takes none. This points at a case the compiler misses. Please report it with the component that caused it.

## FV1013

`class` written apart from a later `:class` in content rendered from virtual nodes.

Inside an element `<component :is>` chooses, in the slot content such an element renders, and inside a `<RouterLink>`, Vue's server renders from virtual nodes, where a static `class` written before `:class` keeps its place and its names come first. ferrovue writes them so when nothing stands between the two; with attributes between them, write the two next to each other, or `:class` first.

## FV1014

`<style module>` whose class names ferrovue cannot compute.

ferrovue names the classes of a CSS module written in the component in plain CSS, as postcss-modules does in Vite. A module in another file (`src`), one a preprocessor compiles (`lang`), and one that imports names from another file (`composes: x from "./a.css"`, `@value x from "./a.css"`) are refused.

## FV1015

`useCssModule` of a module the component does not declare.

`useCssModule()` reads the classes of a `<style module>` in the same component: `useCssModule()` for `$style` and `useCssModule("theme")` for `<style module="theme">`, bound to a name. A name the component declares no module for (where Vue gives an empty object), a name chosen as the page renders, and a call whose result is destructured or not bound are refused. Name a module the component declares, as a string literal.

# Configuration and helpers: FV11xx

See [`quick_start`](crate::guide::quick_start).

## FV1101

Helper called with the wrong number of arguments.

A helper's Rust twin takes the parameters `params` lists under `helpers.functions` in `ferrovue.config.json`, all of them, in that order. A call with fewer or more arguments, as JavaScript allows with optional parameters and defaults, is refused. Pass every argument the Rust function takes.

## FV1102

Configuration file not found.

ferrovue reads `ferrovue.config.json` in the project's root, or the file `--config` names, and found no such file. Create it (`{ "components": "components", "out": "src/generated" }`), or run ferrovue from the directory that holds it.

## FV1103

Configuration file that is not valid JSON.

The configuration file is not valid JSON. The message is the parser's own and says where it stopped. JSON has no comments and no trailing commas.

## FV1104

Configuration without `components` or `out`.

The configuration names the directory of `.vue` files to compile in `components` and the directory the Rust modules are written to in `out`, both as strings, and both are required: `{ "components": "components", "out": "src/generated" }`.

## FV1105

Unsupported `scopeId`.

Scoped styles use ids that `@vitejs/plugin-vue` hashes from each component's path, and in a production build from its source too. `scopeId` is `"filepath-source"` (the default, as `vite build` hashes) or `"filepath"` (as the dev server and `componentIdGenerator: "filepath"` hash); any other value gives the server no way to compute the ids the client uses. See [`scoped_styles`](crate::guide::scoped_styles).

## FV1106

`builders` that is not `true` or `false`.

`builders` is `true` or `false`: whether each props struct gets `new()`, taking its required fields, and a setter per optional field. A string (`"false"`), a number or `null` is refused. Write the JSON boolean.

## FV1107

Unknown helper type.

Helpers and twins name each parameter, return value and prop by one of the types the generated Rust maps: `"string"`, `"string?"`, `"int"`, `"int?"`, `"float"`, `"float?"` and `"bool"`. Any other name, or a missing one (a helper without `returns`), is refused. The message names the key, and the types it takes.

## FV1108

Imported function without a Rust twin.

A component imports a name from the module `helpers.module` names, and `helpers.functions` in `ferrovue.config.json` gives it no Rust twin. ferrovue does not run TypeScript, so the server calls a helper's Rust function. Add the function under `helpers.functions` with its `rust` path, `params` and `returns`.

## FV1109

Twin name that is not PascalCase.

A twin is keyed by its component's name in PascalCase (`VBtn`), as a template uses it as `<VBtn>` or `<v-btn>` and as the generated `VBtnProps` and `VBtnSlots` are named. A kebab-case or lowercase key is refused. Write the key in PascalCase.

## FV1110

Twin without `rust`.

Each twin names the Rust function that renders it in `rust`, as a path with at least one `::` (`crate::ui::v_btn`), which the generated parents call. A twin without `rust`, or one whose value is not such a path, is refused.

## FV1111

Twin prop name that is not camelCase.

Each prop under a twin's `props` becomes a field of its generated props struct, named in snake case from the JavaScript name. A name that is not a plain JavaScript name (`'is-block'`) is refused. Name the prop as the component declares it, in camelCase (`isBlock`); a template may still write it in kebab-case.

## FV1112

Twin slot name that is not a plain name.

Each slot in a twin's `slots` becomes a field of its generated slots struct. A slot name is letters, digits, `_` and `-`, starting with a letter or `_`; a name with other characters is refused.

## FV1113

Configuration that is not a JSON object.

The configuration file holds one JSON object, as `{ "components": "components", "out": "src/generated" }`. A file holding an array, a string, a number or `null` is refused.

## FV1114

Unknown configuration key.

A key ferrovue does not read is refused, as it is most often a misspelt one (`component` for `components`). The message names the key it most likely means.

## FV1115

Configuration value of the wrong type.

A key of the configuration holds a value of another kind than it takes: a string where an object is expected, a boolean written as a string, a list where an object of entries is expected. The message names the key and the shape it takes. The JSON schema `ferrovue/schema.json` lists every key and its type.

## FV1116

Directory the configuration names that cannot be read.

A directory the configuration names (`components`, `stores`, `i18n.messages`) does not exist, is a file, or cannot be read. Paths are relative to the project's root. The message names the key and the reason.

## FV1117

Deprecated configuration key.

A warning: ferrovue still reads the key, and stops reading it in a later minor release before 1.0, and only in a major release from 1.0. The message names what to write instead. A key is deprecated for at least one minor release before it is removed.

## FV1118

Deprecated command-line option.

A warning: the option still works, and is removed in a later minor release before 1.0, and only in a major release from 1.0. The message names what to use instead. An option is deprecated for at least one minor release before it is removed.

## FV1119

`unions` entry that is not the path of a Rust type.

Each entry of `unions` in `ferrovue.config.json` names the Rust enum generated code uses for a union, by a path the generated modules can reach: two or more names joined by `::`, from the crate root (`crate::domain::Tone`) or from a crate the project depends on (`app_domain::Tone`). A single name, a path through `self` or `super`, generic arguments and anything that is not a name are refused. Write the enum's full path.

## FV1120

`unions` entry for an alias no component uses.

Each entry of `unions` in `ferrovue.config.json` names the Rust enum for a union by its `type` alias. An entry whose alias types no prop and no field the components reach is most often a misspelt one, or one left behind when the alias was renamed. Name the alias as its `.ts` file or component declares it, or remove the entry.

# Router: FV12xx

See [`routing`](crate::guide::routing).

## FV1201

Route parameter that is not a present string or number.

A `params` or `query` value in a `to` is written into the link's URL as text, so it must be a string, a number or a boolean that is always there (an optional query value is left out when absent). An optional parameter, `null`, a list or an object has no single text vue-router would agree on. Narrow it first (`props.slug ?? ""`), or link with a `path` string you build.

## FV1202

`to` that is not a string or an object literal.

`<RouterLink>`'s `to` is resolved against the routes while the server renders, which needs either a string or an object literal whose keys the compiler can read. A `to` held in a variable, a prop or a computed object is refused. Write the object in the template (`:to="{ name: 'post', params: { slug } }"`) or build a string path.

## FV1203

Computed or spread key in a `to` object.

The compiler reads a `to` object's keys to decide how to resolve it, so each must be a plain key: `{ name, params, query, hash }` or `{ path, query, hash }`. A spread (`{ ...base, hash }`) or a computed key (`{ [k]: v }`) hides which keys are there. Write the keys out.

## FV1204

Unsupported key in a `to` object.

A `to` object takes `name`, `path`, `params`, `query` and `hash`, and `replace`, `force` and `state`, which change nothing the server renders. Any other key, such as `alias` or `meta`, is refused because the server's resolver has no use for it and cannot tell what vue-router would do with it.

## FV1205

`query` that is not an object literal.

A `to`'s `query` is written key by key into the link's search string, so it must be an object literal in the template. A query object held in a variable or prop has keys the compiler cannot see. Write `query: { page: props.page }`, or put the query in a `path` string.

## FV1206

Computed or spread key in a query.

Each key of a `to`'s `query` becomes a name in the link's search string, so the compiler needs it as a plain key. A spread or computed key (`{ ...filters }`, `{ [name]: value }`) is refused. Write each key out.

## FV1207

Query value that may be `null`.

vue-router writes a query value of `null` as the key alone (`?draft`), and leaves out one that is `undefined`. A value that may be `null` has a Rust type of `Option`, which cannot tell the two apart. Give `undefined` to leave the key out, or a string.

## FV1208

`hash` that is not a string.

A `to`'s `hash` is appended to the link's `href` as text, so it must be a string. A number, an optional value or anything else is refused. Convert it in the template (`'#' + String(props.id)`) or pass a string prop.

## FV1209

Route name that is not a string literal.

A named link is resolved against the route of that name, which the compiler looks up in the routes while compiling, so `name` must be a string literal. A name from a prop or variable could be any route. Write the name in the template, or link with a `path` string.

## FV1210

Unknown route name.

A `to`'s `name` is checked against the routes ferrovue reads from `routes` in `ferrovue.config.json`, and no route has it. vue-router throws on a name it does not know. Check the spelling, and for file-based routes use the name vue-router's plugin gives the page, its path in the folder (`/books/[id]`). See [`routing`](crate::guide::routing).

## FV1211

`params` that is not an object literal.

A named link's `params` fill the route's path, and the compiler checks each one against the parameters the path declares, so `params` must be an object literal in the template. Write `params: { id: props.id }`.

## FV1212

Computed or spread key in `params`.

Each key of `params` is matched against a parameter of the route's path while compiling, so it must be a plain key. A spread or computed key (`{ ...route.params }`, `{ [k]: v }`) hides which parameters are given. Write each parameter out.

## FV1213

Unknown route parameter.

The route named in `to` has no parameter of this name in its path. The compiler checks `params` against the path from the routes file or the page's file name. Check the spelling against the route's `:name` parameters, or remove the entry.

## FV1214

Route parameter not given.

vue-router cannot build a link to a named route without each parameter its path requires, and throws. Give every parameter the route's path does not mark optional (`:name?`, or `[[name]]` in a page file name).

## FV1215

`to` with both `path` and `params`.

vue-router ignores `params` in a `to` that has a `path`, so the link would not hold them. Put the values in the `path` string, or link by `name` with `params`.

## FV1216

`path` that is not a string.

A `to`'s `path` is resolved against the routes as text, so it must be a string. Build it as one (`'/users/' + props.name`).

## FV1217

`to` without `name` or `path`.

A `to` object is resolved by its `name` or its `path`, and the server resolves only these. One with neither, such as `{ query }` alone, is refused. Add the `name` or `path` the link goes to.

## FV1218

`<RouterLink>` attributes that are not literal.

The compiler reads `<RouterLink>`'s attributes one by one to find `to` and its other props, so they must be written in the template. A `v-bind="obj"` of an object held in a variable or prop hides them. Write the attributes out.

## FV1219

Computed or spread key in `<RouterLink>` attributes.

`<RouterLink>`'s attributes are sorted into its props and the attributes it passes to its `<a>` by their names, so each must be a plain key. A spread or computed key in a `v-bind` object hides the name. Write each attribute out.

## FV1220

`custom` on `<RouterLink>`.

`custom` makes `<RouterLink>` render nothing of its own and hand `href`, `navigate` and the active flags to a scoped slot, which ferrovue does not support. Use `<RouterLink>` with its default slot, which renders the `<a>` itself.

## FV1221

`href` or `aria-current` set on `<RouterLink>`.

`<RouterLink>` writes its own `href`, from `to`, and its own `aria-current` when the link is exactly active, and an attribute of the same name would replace it. Set the link's target through `to` and the attribute's value through `aria-current-value`, or use a plain `<a>` for a fixed `href`.

## FV1222

`<RouterLink>` without `to`.

A `<RouterLink>` renders an `<a>` whose `href` comes from `to`, and vue-router requires it. Add `to`.

## FV1223

Element in a `<RouterLink>` given a slot scope id.

In slot content, Vue gives elements the slot's scope id. Inside a `<RouterLink>`, vue-router renders its slot from virtual nodes, which write those ids by rules ferrovue does not reproduce. Move the `<RouterLink>` out of the slot content, or the element out of the link.

## FV1224

`<slot>` in a `<RouterLink>` that takes scope ids.

A `<slot>` inside a `<RouterLink>` is rendered by vue-router from virtual nodes, which carry scope ids by rules ferrovue does not reproduce. It is refused in a component with `<style scoped>`, in slot content, and in a link that receives `$attrs`. Put the `<slot>` outside the `<RouterLink>`, or the link in a component without any of these.

## FV1225

`<RouterLink>` without `routes` configured.

A `<RouterLink>` is resolved against the app's routes while the server renders, and no `routes` is set in `ferrovue.config.json`. Name a JSON file of routes or a folder of pages there. See [`routing`](crate::guide::routing).

## FV1226

`<RouterLink>` attribute that is not a string literal.

`active-class`, `exact-active-class` and `aria-current-value` are written into the generated code, so each must be a string literal. Set the classes for every link with `linkActiveClass` and `linkExactActiveClass` under `router` in `ferrovue.config.json`, or write the value in the template.

## FV1227

Fallthrough attribute that would reach a `<RouterLink>` prop.

The component's root is a `<RouterLink>` that receives its fallthrough attributes, and a parent passes it an attribute named like one of the link's props (`to`, `active-class`, `replace`, `custom` and the like). In Vue it would reach the link as that prop and change what it renders, which ferrovue resolves while compiling. Declare the attribute as a prop and bind it explicitly, or set `inheritAttrs: false`.

## FV1228

Fallthrough attribute that would replace a `<RouterLink>` attribute.

The component's root is a `<RouterLink>` that receives its fallthrough attributes, and a parent passes it `href` or `aria-current`, which would replace the link's own. Declare the attribute as a prop and decide in the component what to do with it, or set `inheritAttrs: false`.

## FV1229

`<RouterLink>` slot other than the default.

`<RouterLink>` renders only its default slot. Content given to a named slot (`<template #icon>`) would not be shown by vue-router. Put it in the default slot.

## FV1230

Route read without `routes` configured.

Reading the route with `useRoute()` or `$route` needs the app's routes, and no `routes` is set in `ferrovue.config.json`. Name a JSON file of routes or a folder of pages there, and pass the request's [`Route`](crate::router::Route) to `render`. See [`routing`](crate::guide::routing).

## FV1231

Route field not available on the server.

The server's [`Route`](crate::router::Route) has `path`, `fullPath`, `hash`, `name`, `params` and `query`. `meta`, `matched` and `redirectedFrom` come from route records and navigation the server does not have. Compute what the template needs from them in Rust and pass it as a prop.

## FV1232

Routes file that is not an array.

A routes file is a JSON array of routes, as `createRouter` takes them. An object or other value at its top is refused. See [`routing`](crate::guide::routing#configuring-the-routes).

## FV1233

Route entry of an unsupported shape.

Each route in a routes file is a path string, or an object with a string `path`, an optional string `name` and an optional array of `children`. A route without a string `path`, or with a `name` or `children` of another type, is refused. See [`routing`](crate::guide::routing#configuring-the-routes).

## FV1234

`typeof` of anything but a query value. Retired in 0.9.0: the compiler no longer raises it.

## FV1235

`??` after a query value with a fallback that is not a string.

`route.query.x ?? fallback` keeps the value a query value, which holds a string, so the fallback must be a string too. Write `route.query.page ?? "1"`.

## FV1236

`<RouterView>` in a component with `<style scoped>`.

Vue gives the page `<RouterView>` shows the scope id of the component holding it, which the server's page, rendered on its own and passed in as a slot, does not carry. Put the `<RouterView>` in a component without `<style scoped>`. See [`scoped_styles`](crate::guide::scoped_styles#what-is-refused).

## FV1237

`<RouterView>` in a child component.

The page a `<RouterView>` shows is passed in by Rust as the `router_view` slot of the component that holds it, so that component must be the one Rust renders. A component that renders it as a child has no way to pass the page through. Render the layout with the `<RouterView>` from Rust directly, and the page into its slot.

## FV1238

`routes` that is neither a routes file nor `{ pages }`.

`routes` in `ferrovue.config.json`, or under `router`, is the path of a JSON file of routes, or `{ "pages": "…" }` naming a folder of pages for file-based routing. Any other value is refused. See [`routing`](crate::guide::routing).

## FV1239

Pages folder that cannot be read.

The folder `routes` names as `{ "pages": "…" }` does not exist or cannot be read. The path is relative to the folder holding `ferrovue.config.json`.

## FV1240

Page file name the router cannot match.

Each part of a page's path is plain text (letters, digits, `-` and `_`) or one whole parameter: `[id]`, `[[id]]` (optional) or `[...path]` (a catch-all, last). A parameter beside text in one part (`prefix-[id].vue`), a repeatable parameter (`[id]+`), an optional catch-all (`[[...path]]`), a parameter parser (`[id=int]`) and a character code (`[x+2E]`) are not matched on the server.

## FV1241

Named view in a page file name.

A page named `name@view.vue` fills a named `<RouterView name="view">`. On the server `<RouterView>` shows only the default view, the slot Rust fills. Show the other content from the page itself or the layout.

## FV1242

`definePage()` in a page.

`definePage()` changes a page's route (its name, path, alias, meta or params) at build time. ferrovue builds the server's routes from the files' paths alone, so the two would disagree.

## FV1243

`<route>` block in a page.

A `<route>` block changes the route vue-router's file-based routing builds for a page (its name, path, alias, meta or params) at build time. ferrovue builds the server's routes from the files' paths alone, so the two would disagree. Name the file for the route it should have.

## FV1244

`_parent.vue` with no pages to hold.

`_parent.vue` is the layout of the pages in its folder, shown with their content in its `<RouterView>`. One in a folder with no other pages, or in the pages folder itself, has nothing to hold. Move it into a folder beside the pages it lays out.

## FV1245

Page whose component name is taken or not a Rust name.

Each page is compiled as a component named after its path in PascalCase (`books/[id].vue` is `BooksId`). A page whose name is a component's in `components`, or another page's (`a-b.vue` and `a_b.vue`), or that starts with a digit, is refused. Rename one of the files.

## FV1246

Routes file that cannot be read.

The routes file `routes` names in `ferrovue.config.json` does not exist or cannot be read. The path is relative to the folder holding `ferrovue.config.json`.

## FV1247

Routes file that is not valid JSON.

The routes file `routes` names is not valid JSON. The message gives the parser's error. A routes file is plain JSON: no comments and no trailing commas.

# Pinia stores: FV13xx

See [`pinia`](crate::guide::pinia).

## FV1301

Type declared by two stores.

Every store's types are written into one `stores` module, so two store files that each declare an interface of the same name would give two Rust structs of one name. Rename one, or declare the type once and import it in the other.

## FV1302

Store id that is not a string literal.

A store's id is its field in the generated `Stores` and its key in `pinia.state.value`, which the client's Pinia starts from, so it must be a string literal. Write `defineStore("cart", …)`.

## FV1303

Store of an unsupported shape.

A store is `defineStore(id, { state, getters, actions })` or a setup store, `defineStore(id, () => { … })`. Options held in a variable, or a store defined another way, are refused because the compiler reads the state's type from them.

## FV1304

Store `state` without a declared return type.

The server never runs a store's `state()`: the state is a Rust struct filled for each request, built from the type `state` returns. Declare it as an interface in the same file and annotate `state: (): CartState => ({ … })`. See [`pinia`](crate::guide::pinia).

## FV1305

Store `getters` that is not an object literal.

A store's getters are written as expressions of the state wherever a component reads them, so the compiler reads each one from `getters`, which must be an object literal.

## FV1306

Getter that is not a function of the state.

Each getter is translated to Rust as an expression of the state, so it must be a function, `(state) => state.count * 2` or a method. A getter given as another value is refused.

## FV1307

Setup store without a block body.

The compiler reads a setup store's state from its `ref`s and the object it returns, which needs a function with a block body: `() => { const count = ref(0); return { count } }`. An arrow returning an object directly is refused.

## FV1308

Unsupported statement in a setup store.

A setup store's function may declare variables and functions, call functions, and return its object. Other statements, such as `if`, loops or `try`, could change what the store holds in ways the server, which never runs the function, cannot follow. Move the logic into an action or a function the store declares.

## FV1309

Setup store that does not return an object.

A setup store's state, getters and actions are the names it returns, so it must end with `return { … }`. A function that returns nothing or another value is refused.

## FV1310

Setup store returning anything but plain names.

The compiler matches each returned name to the `ref`, `computed` or function it was declared as, so the object holds plain names, shorthand or renamed: `{ count, doubled, increment }`. A spread, a computed key or an expression is refused. Declare the value in the store's function and return its name.

## FV1311

Setup store returning a name it does not declare.

Each name a setup store returns is looked up among the variables and functions its function declares, and this one is not among them, such as a name imported from elsewhere. Declare it in the store's function, or leave it out of the returned object.

## FV1312

Interface named as a setup store's state type.

A setup store's state becomes a Rust struct named after its id in PascalCase with `State` (`cart` is `CartState`), and an interface in the stores of the same name would give two structs of one name. Rename the interface.

## FV1313

`ref<T | null>()` without a value.

`ref<T | null>()` starts `undefined` and may later be `null`. Its Rust type is an `Option`, whose `None` cannot be both. Start it at `null`: `ref<T | null>(null)`.

## FV1314

Setup store `ref` without a type.

The state's Rust type is read from `ref<T>()`, or from a literal start value: a string, a number, a boolean or a non-empty list of one of them. A `ref` started from anything else, such as `ref([])` or `ref(props.x)`, gives no type. Write the type: `ref<string[]>([])`.

## FV1315

Getter with a block body.

A getter is translated to Rust as a single expression of the state. One whose body has statements beyond a lone `return` is refused. Write it as an expression, `(state) => state.items.length > 0`, or compute the value in Rust and keep it in the state.

## FV1316

Getter that reads `this`.

On the server a getter reads the state through its parameter. `this` in an option store's getter reaches the whole store, getters and actions included, which the server does not have. Read the state through the parameter: `(state) => state.count * 2`.

## FV1317

Getter that returns a function.

A getter that returns a function takes its arguments where a component calls it, which the server translates as a fixed expression of the state. Write the computation in the component, with a helper that has a Rust twin, or compute it in Rust and pass it as a prop.

## FV1318

Getters that read each other.

The compiler writes a getter that reads another getter by writing that getter's expression in its place. Two getters that read each other would never end. Break the cycle so that one of them reads only the state.

## FV1319

Store imported by anything but its `use…` hook.

A component takes a store by importing its `use…` hook, and types from the store's file. A default import, a namespace import, or another value from a store file is refused, since the server has only the store's state. Import the hook, `import { useCart } from "../stores/cart"`, and read the store through it.

## FV1320

`storeToRefs` of anything but a store bound in setup.

`storeToRefs(store)` takes one argument, a store bound in this component's setup by its hook: `const cart = useCart(); const { items } = storeToRefs(cart)`. One called on anything else gives the compiler no store to read.

## FV1321

`storeToRefs` not destructured into plain names.

Each name destructured from `storeToRefs` is bound to a field of the store's state or a getter, so the pattern holds plain names, shorthand or renamed: `const { items, total: sum } = storeToRefs(cart)`. A nested pattern, a default value or a rest element is refused.

## FV1322

Store hook called with arguments.

A store hook called with an argument, such as `useCart(pinia)`, reads a Pinia other than the page's. The server has one set of stores, the `Stores` passed to `render`. Call the hook with no arguments.

# vue-i18n: FV14xx

See [`i18n`](crate::guide::i18n).

## FV1401

Locale file that is not valid JSON.

A `.json` file in the `i18n.messages` directory does not parse as JSON. The compiler reads every locale file when it compiles, and the message is the parser's own. Fix the file, or move a file that holds no locale out of that directory.

## FV1402

Locale message that does not parse.

ferrovue runs vue-i18n's own message compiler on every message at build time, and it refused this one. The message names the key and the compiler's reason. Write a literal `{`, `}`, `@` or `|` as a literal value (`{'@'}`), as vue-i18n's message syntax asks.

## FV1403

Linked message with a key chosen at run time.

A linked message whose key is a placeholder (`@:{name}`, `@:{0}`) picks the message it links to from a value given at render. ferrovue links messages by keys written in the locale file, which it resolves at build time. Write the key out (`@:common.app`), or choose between messages with `t()` in the template.

## FV1404

Linked message with an unknown modifier.

A linked message's modifier (`@.upper:key`) is one vue-i18n defines: `upper`, `lower` or `capitalize`. Other modifiers are functions given to `createI18n` on the client, which the server does not run. Use one of the three, or write the message in the form it should show.

## FV1405

Locale message construct ferrovue does not render.

vue-i18n's message compiler gave a node ferrovue has no translation for. ferrovue renders text, named (`{name}`) and list (`{0}`) values, literals (`{'{'}`), linked messages and plural cases. Please report it with the message that caused it.

## FV1406

`t()` value that is not a present string, number or boolean.

A value given to `t()`, among its named values or in its list, is a string, a number or a boolean that is present. vue-i18n turns `undefined`, `null`, lists and objects into text by rules of its own, which ferrovue does not reproduce. Narrow an optional value with `v-if` first, or fall back with `??`.

## FV1407

`t()` without `i18n` configured.

A template calls `$t` or `useI18n()`'s `t`, and `ferrovue.config.json` has no `i18n`. The compiler reads the messages from the locale files at build time and needs their directory: `"i18n": { "messages": "client/locales" }`, one JSON file per locale. See [`i18n`](crate::guide::i18n).

## FV1408

`t()` with unsupported arguments.

`t()` takes a key, then up to two of: named values (an object literal), a list (an array literal) and a plural number. A call with no arguments, or with more than three, is refused.

## FV1409

`t()` key that is not a string.

The first argument of `t()` is the message key, a string: a literal (`t("greeting")`) or a string the template computes (`t("status." + props.state)`). A key of another type is refused. A key found in no locale renders as the key itself, as vue-i18n does.

## FV1410

Computed or spread key in `t()`'s named values.

Named values are an object literal of plain keys: `t("greeting", { name })` or `{ name: props.name }`. A computed key (`{ [k]: v }`), a spread or a method has no name known when compiling, and the generated `Args` names each value in the code.

## FV1411

Default message given to `t()`.

A string given to `t()` after the key is vue-i18n's default message, shown when the key is missing. ferrovue renders only the messages in the locale files, which it compiles at build time. Add the message to the locale files.

## FV1412

Plural number that is not an integer.

A number given to `t()` after the key chooses the plural case, and ferrovue takes it as an integer. Round it, or pass the number as a `count` named value, which may be a fraction and chooses the case as vue-i18n does. See [`i18n`](crate::guide::i18n#what-is-supported).

## FV1413

`useI18n()` not destructured into plain names.

What `useI18n()` returns is destructured into plain names, renamed or not: `const { t, locale } = useI18n()`. A rest element, a computed key, a nested pattern or a default leaves the compiler without a name for each part. Of the parts, `t` and `locale` render on the server; `d`, `n` and the rest are client-only.

# Raw HTML, client-only content, teleports and Rust twins: FV15xx

See [`errors_and_limits`](crate::guide::errors_and_limits).

## FV1501

Twin props that are not attributes or an object literal.

A Rust twin's props are written as attributes (`<VBtn :label="name">`) or an object literal in `v-bind` (`v-bind="{ label: name }"`). The compiler fills the twin's generated `VBtnProps` field by field, and `v-bind` of another value gives it no fields to read. Write the props out. See [`errors_and_limits`](crate::guide::errors_and_limits#rust-twins).

## FV1502

`v-html` of anything but a `TrustedHtml` prop.

`v-html` writes raw HTML, which ferrovue allows only from a type you mark as trusted. See [`escaping`](crate::guide::escaping).

## FV1503

`TrustedHtml` prop without `trustedHtml` configured.

A prop typed `TrustedHtml` is a field of the Rust type named by `trustedHtml` in `ferrovue.config.json`: `ferrovue::html::BasicHtml`, `ferrovue::html::InlineHtml`, `ferrovue::html::Sanitised` (the `ammonia` feature) or a type of your own that implements `ferrovue::html::TrustedHtml`. Set it, or type the prop `InlineHtml` (inline tags only), which needs no setting. See [`escaping`](crate::guide::escaping).

## FV1504

Attributes on `<ClientOnly>`.

`<ClientOnly>` renders no element of its own, so the server has nowhere to write attributes given to it. Put them on an element inside it, in the `#fallback` and in the default slot.

## FV1505

`<ClientOnly>` slot other than the default and `#fallback`.

`<ClientOnly>` has a default slot, which the client renders once mounted, and a `#fallback` slot, which the server renders and the client hydrates. Another named slot, or one whose name is chosen at run time (`#[name]`), is refused. Put its content in one of the two.

## FV1506

Slot props taken from `<ClientOnly>`'s `#fallback`.

`<ClientOnly>`'s `#fallback` slot is given no props, so `#fallback="{ x }"` or `v-slot:fallback="props"` has nothing to read. Use the values of the parent's own scope.

## FV1507

`<Teleport>` in slot content whose emptiness is decided at run time.

Where slot content may render nothing, as with a `v-if` or a `v-for` over a list that may be empty, the child shows its fallback when the content wrote nothing but comments. A `<Teleport>` there writes only its markers in place and its content elsewhere, and ferrovue does not decide whether that counts as content. Move the `<Teleport>` out of the slot content, or put it beside an element that always renders.

## FV1508

`<Teleport>` target that is not a string.

A `<Teleport>`'s `to` is a present string, a CSS selector written in the template (`to="#modals"`) or bound (`:to="target"`). Vue also takes an element, which the server has none of, and the page collects each target's content from `Teleports` by that string. See [`teleports`](crate::guide::teleports).

## FV1509

Twin prop of a type with no Rust type. Retired in 0.10.0: the compiler no longer raises it.

## FV1510

Twin for a component ferrovue compiles.

A name under `twins` in `ferrovue.config.json` is also a `.vue` file ferrovue compiles. A twin renders a component the compiler does not compile, so one component cannot be both. Remove the twin to compile the component, or rename one of them.

## FV1511

`<ClientOnly>` with a `#fallback` in content rendered from virtual nodes.

Inside an element `<component :is>` chooses, inside a `<RouterLink>` or a twin's slot, and in the slot content they render, Vue's server renders from virtual nodes, and `<ClientOnly>` writes an empty fragment there and leaves out its fallback, which the client then renders and reports as a mismatch. Leave out the `#fallback`, or move the `<ClientOnly>` outside that content.

## FV1512

`v-html` on an element whose content the browser rebuilds.

The browser's HTML parser moves markup written in a `<table>`, `<thead>`, `<tbody>`, `<tfoot>`, `<tr>` or `<colgroup>` out of the table, drops the tags written in a `<select>` or `<optgroup>`, and ends SVG or MathML at an HTML tag, so the page holds other nodes than the server wrote and hydration mismatches. Put `v-html` on a `<td>`, `<th>` or `<caption>`, write the options in the template, or use an HTML element inside a `<foreignObject>` or an `<mtext>`. See [`escaping`](crate::guide::escaping).

## FV1513

`v-html` in a `<p>` of HTML that may hold blocks.

A block tag in the HTML (`<p>`, `<ul>`, `<div>`) ends the `<p>` it is written in where the browser reads it. Type the prop `InlineHtml` from `ferrovue/types`, which is `ferrovue::html::InlineHtml` on the server and keeps only inline tags, or put the HTML in a `<div>`. Slot content placed into a child's `<p>` is not seen at compile time. See [`escaping`](crate::guide::escaping).

# Provide and inject: FV16xx

See [`provide_inject`](crate::guide::provide_inject).

## FV1601

Injection key that is not a string literal or a symbol exported from a `.ts` file.

An injection key is a string literal (`provide("theme", …)`) or a `Symbol` exported from one of the project's `.ts` files (`export const ThemeKey: InjectionKey<string> = Symbol()`). The generated `Provides` has one field per key, so the compiler knows each key when compiling and finds it the same in every component. A symbol declared in the component, or a key held in a variable, is refused. See [`provide_inject`](crate::guide::provide_inject#keys).

## FV1602

Injection key symbol without an `InjectionKey<T>` type.

A key symbol is typed `InjectionKey<T>`, by annotation or `as`: `export const ThemeKey: InjectionKey<string> = Symbol()`. The `T` is the Rust type of the key's field in `Provides`; `InjectionKey<Ref<T>>` holds `T`, provided as a ref.

## FV1603

`provide` or `inject` with unsupported arguments.

`provide` takes a key and a value. `inject` takes a key, may take a default, and may take `true` or `false`, written as a literal, saying whether the default is a factory. Other numbers of arguments, and a third argument that is not a boolean literal, are refused.

## FV1604

`inject` that is not bound to a name at the top of `<script setup>`.

What `inject` returns is bound to one name: `const look = inject(LookKey)`. The compiler maps that name to the key's field in `Provides`, so a destructuring pattern (`const { size } = inject(LookKey)`) is refused. Bind the object and read its fields (`look?.size`).

## FV1605

`inject(key)!`, asserting a provider.

`inject(key)!` asserts that an ancestor provides the key. A render without one, such as a component rendered from Rust with `Provides::default()`, would have nothing there. Read the value with `?.`, or give `inject` a default.

## FV1606

`inject` of a string key with neither a default nor a type argument.

A string key has no declared type, so the compiler takes one from an `inject` type argument (`inject<string>("theme")`), a default, or a `provide` of the key. None of them gives one here, and the key's field in `Provides` needs a Rust type. Add a type argument or a default, or use an `InjectionKey<T>` symbol.

## FV1607

Function default without the factory flag.

Vue takes a function given as `inject`'s default as the value itself unless the third argument is `true`, and only an event handler could call such a value. Pass `true` to have it called for the default: `inject("tone", () => "plain", true)`. With `true`, the default is a function of no arguments whose body is an expression or a single `return`.

## FV1608

Values of different types provided under one key.

A key is one field of the generated `Provides`, so every `provide` and `inject` of it agree on its type: an `InjectionKey<T>`'s `T`, or for a string key the first type it is given. Two objects agree when both are one interface from a shared `.ts` file. Give the values one type, or use two keys.

## FV1609

Provided value that may be `null` or `undefined`.

`inject` hands on a provided `null` or `undefined` as it is, where without a provider it gives its default. The key's field in `Provides` is `None` in both cases, so the server could not tell them apart. Fall back with `??` before providing: `provide(ThemeKey, props.theme ?? "light")`.

## FV1610

Provided value of a form the context does not hold.

The generated `Provides` has field types for strings, numbers, booleans, lists, objects of an interface, a child's props and `TrustedHtml` props. A provided list is one the component holds, a prop or a `computed` of one; a list built in place (`[a, b]`, `.filter(…)`) is refused. Wrap it in a `computed` and provide that.

## FV1611

Object provided or given as a default under a key without an interface type.

An object literal provided, or given as `inject`'s default, is built as a struct whose fields come from the key's interface. A string key, or an `InjectionKey<T>` whose `T` is not an interface, gives it none. Use an `InjectionKey<T>` whose `T` is an interface from a shared `.ts` file.

## FV1612

Provided or default object whose fields do not match its interface.

An object provided or given as a default is built as the key's interface: each key is a plain name that is a field of it, every required field is given, and no value is a function. A ref in a plain object stays a ref in Vue; wrap the object in `reactive()`, which unwraps it, or read `.value`. A function goes under a key of its own.

## FV1613

Ref and plain value under one key.

What is injected under a key provided as a ref is read with `.value`, and one provided as a plain value is not. Every `provide` of a key, and every default `inject` gives it, is a ref or a plain value alike, so `.value` reads the same with a provider and without one. Under a ref key, make the default `ref(…)` or `computed(…)`.

## FV1614

Key provided twice by one component.

A component that calls `provide` twice with one key gives its descendants the second value in place of the first. Provide the key once, choosing the value with `computed` or `?:`.

## FV1615

Two keys that give the context one field name.

Each key is a field of the generated `Provides`, named in snake case after a string key or a symbol's name. Two keys such as `"theme-color"` and `"themeColor"`, or a string key and a symbol `ThemeColor`, would be the one field `theme_color`. Rename one.

## FV1616

`provide` in a component that holds `<RouterView>`.

The page `<RouterView>` shows is rendered from Rust and handed in as a slot, so it cannot see what the component provides. Provide the value above the router (in Rust, through the `Provides` the page is rendered with) or below it.

## FV1617

String-keyed `inject` inside a Rust twin's slot.

Content in a twin's slot is a child of the library component the twin stands for, which may provide the same string key on the client. Use an `InjectionKey` symbol, which only the project provides.

## FV1618

Setup that assigns to an injected value.

Setup that assigns to an injected value, or to a field of it, changes an ancestor's state while the page renders. The components rendered before this one have already shown the value it had. Compute the value where it is provided, or keep a local `computed` of the injected one.

## FV1619

Function and value provided under one key.

A key whose value is a function is client-only: what `inject` returns may be called only from event handlers, and `Provides` has no field for it. A key provided with a function in one place and a value in another would be both. Provide state and functions under keys of their own.

## FV1620

`provide` or `inject` called inside an expression.

`provide(…)` is a statement of its own, and `inject(…)` the whole initialiser of a binding, at the top of `<script setup>`. The compiler translates them only there; inside a `computed`, a condition or another call they are refused. Move the call to the top level and use the name it is bound to.

# Page head: FV17xx

See [`head`](crate::guide::head).

## FV1701

Options given to `useHead`.

`useHead`'s second argument, its options, changes how unhead adds the input, which ferrovue does not reproduce. Give the input alone; `tagPriority` and `tagPosition` may go on each tag that needs them.

## FV1702

Head input that is not an object literal.

`useHead` and `useSeoMeta` take an object literal, or a getter returning one (`useHead(() => ({ title: props.title }))`). The compiler translates the input key by key, so an object held in a variable or imported gives it nothing to read. Write the object in the call.

## FV1703

Head key ferrovue does not translate.

The keys of the head ferrovue translates are `title`, `titleTemplate`, `base`, `meta`, `link`, `script`, `style`, `noscript`, `htmlAttrs` and `bodyAttrs`. `templateParams` and a tag's `processTemplateParams` need unhead's template params plugin, which ferrovue does not reproduce; write the final values instead. See [`head`](crate::guide::head#what-a-component-may-pass).

## FV1704

Spread, computed key, hole or method in a head input.

A head input is an object literal of plain keys and values, and its arrays hold plain values. A spread, a computed key, a method or an array hole gives the compiler no tag or attribute known when compiling; write each one out, and build tags from a list with `list.map((x) => ({ … }))`. `__proto__` is refused, since JavaScript reads it as the object's prototype.

## FV1705

Function in a head input.

unhead calls a function given as a value on the server only when it takes no arguments, as a getter (`title: () => props.title`), which ferrovue evaluates. A `titleTemplate` function and an event handler (`onload`) run with arguments or on the client.

## FV1706

Head value of a type the head does not take.

Each head key takes values of given types: `title` and an attribute a string, a number or a boolean, which may be absent; `class` and `style` a string, a list of strings or an object literal; `base`, `htmlAttrs` and `bodyAttrs` an object literal; a tag key an object literal, an array of them or `list.map(…)`. A value that may be both `undefined` and `null` is refused, since unhead treats the two apart and its Rust type has one `None`. Narrow the value, or compute it in Rust and pass it as a prop.

## FV1707

`tagPosition`, `tagPriority` or `tagDuplicateStrategy` that is not a literal it accepts.

`tagPosition` is `"head"`, `"bodyOpen"` or `"bodyClose"`; `tagPriority` a number literal or `"critical"`, `"high"` or `"low"`; `tagDuplicateStrategy` `"replace"` or `"merge"`. They decide where unhead writes a tag and how it orders and deduplicates it, and the compiler takes each only as a literal. A value computed at run time, or another string, is refused.

## FV1708

`useHeadSafe`.

`useHeadSafe` passes its input through unhead's safe input plugin, which keeps only the tags and attributes it deems safe. ferrovue does not reproduce that filter. Use `useHead` with values the page trusts, and keep text you do not control out of `script` and `style`.

## FV1709

`useSeoMeta` key or value ferrovue does not translate.

`useSeoMeta` takes camel-case keys that name a meta tag (`description`, `ogTitle`, `twitterCard`), with `title` and `titleTemplate`, and values that are strings, numbers, booleans, `null` or absent. A key of `useHead`'s tags (`class`, `key`, `tagPriority`, `innerHTML`) is refused, as is an object or array value, which unhead unpacks into tags of its own. Write the value as a string, or use `useHead` for those tags.

## FV1710

`class` or `style` in the head that may be `null`.

unhead's server renderer throws on a `class` or `style` of `null`. Write `?? undefined`, which leaves the attribute out.

## FV1711

`innerHTML` or `textContent` on a head tag that has no content.

`innerHTML` and `textContent` set the content of a `script`, `style` or `noscript` tag. A `meta`, `link` or `base` has no content to set. Remove the key, or move the content into a `script`, `style` or `noscript` entry.

# Dates and locale formatting: FV18xx

See [`dates_and_prices`](crate::guide::dates_and_prices).

## FV1801

The current time: `new Date()` or `Date.now()`.

The server renders at one moment and the browser hydrates at another, so the text would differ. Read the time in Rust and pass it as a prop: an ISO string, or a number of milliseconds. See [`dates_and_prices`](crate::guide::dates_and_prices).

## FV1802

`new Date()` or `Date.parse()` of anything but one present string or number.

`new Date(year, month, …)` reads its parts in the time zone of the machine running it. A value that may be absent gives an invalid date for `undefined` and the epoch for `null`. See [`dates_and_prices`](crate::guide::dates_and_prices).

## FV1803

Date string that browsers may read differently.

ECMAScript specifies how a date alone (`2024-05-01`, `2024-05`, `2024`) and a date and time with a `Z` or an offset (`2024-05-01T09:30:00.000Z`, `2024-05-01T09:30+02:00`) are read. A date and time with neither is read in the time zone of the machine running it, and every other string by each engine's own rules, as are fields out of range (`2024-02-30`, `T24:00`) and fields beyond the range of dates that an offset brings back within it (`+275760-09-13T01:00+01:00`), which Safari reads as invalid. A literal is checked when the component is compiled; a string from the props is checked as it renders, and one outside the format is refused there: a generated `try_render` returns it as a `ferrovue::render::Refused`, with the component and the line and column of the expression, so a server can answer `400 Bad Request`; `render` panics with its message. See [`dates_and_prices`](crate::guide::dates_and_prices).

## FV1804

`Date` method or function ferrovue does not translate.

A date is read with `.toISOString()`, `.toUTCString()`, `.toJSON()`, `.getTime()`, `.valueOf()` and the `.getUTC…()` methods, which do not depend on the time zone. The local getters (`.getFullYear()`, `.getHours()`), `.getTimezoneOffset()` and `.toString()` read the time zone of the machine running them, which differs between the server and the reader's browser. See [`dates_and_prices`](crate::guide::dates_and_prices).

## FV1805

Locale formatting with `Intl`, `.toLocaleString()`, `.localeCompare()`, `$d` or `$n`.

`Intl` formats from locale data each JavaScript engine ships, and Node, Chromium, Firefox and Safari write some dates, times and numbers differently (spaces, separators, abbreviations), so no server can write what every reader's browser writes. This refusal is permanent. Format the value in Rust and pass it as a string prop, or write it with `.toFixed()` and `.toISOString()` into a message `$t` translates. See [`dates_and_prices`](crate::guide::dates_and_prices).

## FV1806

`Date` in Pinia state, `provide`, `inject`, a `ref` or a `defineModel`.

A `Date` in a prop, itself or inside a list, a dictionary or an object, is a `ferrovue::date::JsDate`, or the type `dateType` names, and so is one in a loader's result. An island's `data-props` and the page's payload carry it as its ISO string, with a plan the compiler writes of where the dates are, from which the client turns each back into a `Date`. Pinia state, a value given to `provide` or read by `inject`, a typed `ref` and a `defineModel` reach the browser with no such plan, so a date in them would arrive as a string. Pass the ISO string or the number of milliseconds and build the date with `new Date()`. See [`dates_and_prices`](crate::guide::dates_and_prices).

## FV1807

`Date.UTC()` of anything but one to seven numbers that are present.

`Date.UTC(year, month, date, hours, minutes, seconds, ms)` takes numbers, each truncated toward zero, the month counted from 0. A value that may be absent would give `NaN` for `undefined` and `0` for `null`: narrow it with `v-if` or give it a default. See [`dates_and_prices`](crate::guide::dates_and_prices).

## FV1808

`Date.UTC()` of parts engines compute differently.

V8 computes a year beyond ±1,000,000, a month beyond ±10,000,000 and a year before −399,999 by rules of its own, which Firefox and Safari do not share, so a day or hours that bring the date back within the range give another date in each; and Node rounds a part worth more than 2⁵³ ms that the others bring back within the range otherwise than the browsers. Literal parts are checked when the component is compiled; parts from the props are checked as it renders, and refused there: a generated `try_render` returns it as a `ferrovue::render::Refused`, with the component and the line and column of the expression, so a server can answer `400 Bad Request`; `render` panics with its message. See [`dates_and_prices`](crate::guide::dates_and_prices).

## FV1809

`===`, `!==`, `==` or `!=` with a `Date`.

Two `Date`s are equal in JavaScript only when they are one object, so two dates of the same time are unequal, and `==` with a string compares the date's `.toString()`, in the time zone of the machine running it. Compare time values: `a.getTime() === b.getTime()`. `<`, `<=`, `>` and `>=` between two dates compare their time values, and are false when either is invalid. See [`dates_and_prices`](crate::guide::dates_and_prices).

## FV1810

List of lists or dictionaries of `Date`s.

A list of `Date`s, `(Date | null)[]` and `Record<string, Date>` are each read as their dates' time values, and a list of them, as `Date[][]`, is refused. Hold each inner list in an object, `{ at: Date[] }[]`, whose field the template reads. See [`dates_and_prices`](crate::guide::dates_and_prices).

## FV1811

`.toISOString()` of an invalid date, as it renders.

`.toISOString()` throws a `RangeError` for an invalid date, which fails the render in Vue as well. A date from the props that is invalid where the template calls it is refused as the component renders. A generated `try_render` returns it as a `ferrovue::render::Refused`, with the component and the line and column of the expression, so a server can answer `400 Bad Request`; `render` panics with its message. See [`errors_and_limits`](crate::guide::errors_and_limits#refused-at-render-time). Test the date first (`v-if="!Number.isNaN(d.getTime())"`), or write it with `.toJSON()`, which gives `null` for an invalid date. See [`dates_and_prices`](crate::guide::dates_and_prices).

## FV1812

Date a child's `Date` prop cannot hold, as it renders.

A component passes a date it computed to a child's `Date` prop, whose Rust type is the one `dateType` names. A type that holds fewer dates than JavaScript, such as `chrono::DateTime<Utc>`, which holds no invalid date nor one beyond ±262,142 years, cannot hold every date a parent computes. Such a date is refused as the component renders. A generated `try_render` returns it as a `ferrovue::render::Refused`, with the component and the line and column of the expression, so a server can answer `400 Bad Request`; `render` panics with its message. See [`errors_and_limits`](crate::guide::errors_and_limits#refused-at-render-time). Check the dates before rendering, or name a `dateType` that holds every date, such as `ferrovue::date::JsDate`. See [`dates_and_prices`](crate::guide::dates_and_prices).

# Statements and functions: FV19xx

See [`script_logic`](crate::guide::script_logic).

## FV1901

Statement a function's body may not hold.

A `computed`, a list method's callback and a function the server calls may hold `const` and `let` declarations, assignments to the body's `let`s, `if` / `else`, blocks, `switch`, `for…of` and counting `for` loops with `break` and `continue`, and `return`. `while`, `do…while` and `for…in` loops, `try`, `throw`, `var`, other expression statements, labels, and functions or classes declared inside the body are refused: iterate with `for…of`, and pass anything else in as a prop. See [`script_logic`](crate::guide::script_logic).

## FV1902

Assignment the server does not translate.

A body assigns only the `let`s it declares itself, each assignment (`=`, `+=`, `++` and the like) a statement of its own. An assignment inside an expression, to a field or an item of an object or a list, to a `const`, a parameter, a prop, a ref or a `computed`, or from a function inside the body to a `let` of the body around it is refused, and so is a function declared in the body that reads a `let` the body assigns again, since the server gives it the value the `let` holds where the function is declared. See [`script_logic`](crate::guide::script_logic#loops-and-assignments).

## FV1903

Function that can end without returning a value.

JavaScript returns `undefined` from a function that reaches its end, or a bare `return;`. The compiler refuses both, so that every path says what it gives: add a `return` (or an `else`, or a `default:` to a `switch`) on the path the message points at, and write `return undefined` where that is meant.

## FV1904

`switch` or code after `return` the compiler does not translate.

A `case` ends in `return` or `break`, or is empty and shares the next case's statements; a declaration directly in a `case` belongs to the whole `switch`, so wrap the case's statements in `{ … }`; code after `return` or `break` never runs.

## FV1905

Body with too many paths after its `if`s and `switch`es.

A statement that can fall off its end, an `if` without `return` or a `case` that ends in `break`, continues with the statements after it, and the compiler translates them once for each path that reaches them. Sequential `switch`es of `break`ing cases multiply those paths: the body is refused past 4096 of them, before translating it would take seconds or exhaust memory. End the cases in `return`, or split the body into several `computed`s that each read the one before.

## FV1906

Function that calls itself.

The server translates a function where it is called, with the arguments it is given there. A function that calls itself, directly or through others, would be translated without end: compute the value in Rust and pass it as a prop.

## FV1907

Function or call of a shape the server does not translate.

A function the server calls takes named parameters, optional ones (`x?: T`) and ones with defaults (`x = 1`) included, and object or array patterns of names; it is called with at most as many arguments as it names, none of them spread. `...rest` parameters, `async` functions and generators are refused, and so is a default for a parameter given a value that may be `null` or `undefined`, which the server cannot tell apart.

## FV1908

Function declared with `const`, called while setup runs before its declaration.

A function declared with `const` (`const f = (…) => …`) exists only once its declaration has run. Setup code above it that calls it, directly or through a `function` declaration, which is hoisted, throws a `ReferenceError` in JavaScript, and Vue's server renders nothing. A `computed` may call it, since a `computed` runs when the render reads it. Move the declaration above the call, or declare the function with `function`.

## FV1909

Loop of a shape the compiler does not translate.

A `for…of` loop declares its item in its head, `for (const x of list)`, or its index and item, `for (const [i, x] of list.entries())`. A `for` loop counts: `for (let i = start; i < end; i++)`, with `<`, `<=`, `>` or `>=` and `i++`, `i--`, `i += k` or `i -= k` of a whole `k`, from an integer to an integer bound the body does not change, and a body that leaves `i` to the head. Any other loop may run without end, and is refused. See [`script_logic`](crate::guide::script_logic#loops-and-assignments).

## FV1910

`for…of` over a value that is not a list or a string.

`for…of` iterates a list of strings, numbers, booleans or objects (a prop, a `computed`, the result of a list method, an array literal, `Object.keys()` or `Object.entries()`), or a string by its characters as JavaScript does: a character beyond U+FFFF is one item. A value that may be absent is narrowed first, or iterated as `x ?? []`, and a list of optional values keeps the ones present with `.filter(Boolean)`. See [`script_logic`](crate::guide::script_logic#loops-and-assignments).

## FV1911

Value a loop carries or returns that is not a string, a number or a boolean.

A `let` a loop assigns is carried from one item to the next in a Rust variable, and a `return` inside a loop keeps its value for after the loop: each holds a string, a number or a boolean, which a `let` may hold as `T | undefined` or `T | null`. Build a list with `.map()` or `.filter()`, pick an item with `.find()`, or return after the loop. See [`script_logic`](crate::guide::script_logic#loops-and-assignments).

## FV1912

`let` assigned a value of another type.

A `let` keeps the type TypeScript gives it: the one it is declared with (`let label: string | undefined = undefined`), or the type of its first value. Assigning it a value of another type, `++` or `--` of a value that is not a number, a `let` that starts as `undefined` or `null` with no type, and a `let` holding a function are refused: give the other value a `let` of its own, or state the type. See [`script_logic`](crate::guide::script_logic#loops-and-assignments).

# Loaders: FV20xx

See [`loaders`](crate::guide::loaders).

## FV2001

`await` of a value that is not a loader's result.

A component's top-level `await` stops its render until the promise settles, on the server as in the browser. The server has the results only of loaders, functions declared with `defineLoader` that the Rust app implements, awaited one by one or together by `Promise.all` of an array literal of their calls; any other promise is the browser's alone. Declare the function as a loader, or fetch the value in Rust and pass it as a prop.

## FV2002

Loader declaration the compiler cannot read.

A loader is declared as `export const loadPost = defineLoader("loadPost", async (id: number): Promise<Post> => …)`, with `defineLoader` imported from `ferrovue`: the name as a string literal that is a JavaScript name, and an `async` function the compiler reads the parameters and result type from.

## FV2003

Loader parameter that is not a plain typed string, number or boolean.

A call's arguments are its key, `JSON.stringify([name, ...args])`, which the Rust app computes from the same values. Each parameter is a plain name with a type: a string, a number (`Float` for a fractional one) or a boolean, which may be optional (`lang?: string`) or `null` (`lang: string | null`), or an interface of a `.ts` file whose fields are such values, written into the key with its keys sorted. Defaults, `...rest`, destructuring, objects written in place, optional objects and objects holding objects or lists are refused: pass the values one by one, or declare the object as an interface.

## FV2004

Loader result the payload cannot carry.

A loader declares what it returns, `Promise<T>`, which is the Rust app's `Output` for it and travels to the client as JSON in the page's payload. `undefined` is dropped by `JSON.stringify`, so the client would hydrate from another value: return `null` for none. A `Date` in the result, itself or inside a list, a dictionary or an object, travels as its ISO string with a plan of where the dates are, and the client turns each back into a `Date`.

## FV2005

Two loaders with one name.

A loader's name is its key in the page's payload and its method in the generated `Loaders` trait, so it is unique in the project: two `defineLoader` calls with one name, or names that are one Rust name (`loadPost` and `load_post`), are refused. Rename one.

## FV2006

Loader call whose arguments do not match its parameters.

Each argument has the type of its parameter, every parameter that is neither optional nor `undefined` is given, no extra argument is given, and none is spread from a list. A value that may be `null` goes only to a parameter that may be `null`, and one that may be `undefined` only to an optional parameter, since the key writes the two differently.

## FV2007

Loader result bound to a pattern.

`const post = await loadPost(id)` binds the result to a name; `const { title, tags } = await loadPost(id)` destructures the object it returns into plain names. `const [post, views] = await Promise.all([…])` binds each call's result to a name. Nested patterns, defaults, `...rest`, and array patterns of anything but `Promise.all` are refused: bind the result and read its fields.
