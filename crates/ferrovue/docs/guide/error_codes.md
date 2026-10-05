Every error the compiler raises has a stable code, shown as `error[FV0602]` and in the `code`
field of `ferrovue --format json`. A code names one kind of refusal and is never given to another:
one the compiler stops raising stays listed here, marked retired. The first two digits are the
area. [`errors_and_limits`](crate::guide::errors_and_limits) explains what the compiler refuses
and why.

This page is generated from the compiler's list in `packages/ferrovue/src/errors.ts` by
`pnpm errors:generate`; `pnpm test` fails when the two differ.

# Components and parsing: FV00xx

## FV0001

Source file that does not parse.

A `<script setup>` block, or a file it reads, is not valid TypeScript. The message is the parser's own, with the line and column where it stopped.

## FV0002

Component file Vue cannot parse.

## FV0003

`<script>` without `setup`.

## FV0004

Component without a `<template>`.

## FV0005

Template Vue cannot compile.

## FV0006

Unexpected construct in Vue's compiled template.

The compiler met output of Vue's server compiler that it has no translation for. Please report it with the component that caused it.

## FV0007

Component file name that gives no Rust module of its own.

Each component is written to a Rust module named after its file in snake case (`UserCard.vue` is `user_card.rs`). A file name that is not letters, digits and `_` starting with a letter, two names with the same snake case (`FooBar.vue` and `Foo_bar.vue`), `Mod.vue`, and a name a module ferrovue writes for the project already has (`Types.vue`, `Stores.vue`) are refused.

# Script setup: FV01xx

## FV0101

`inheritAttrs` that is not `true` or `false`.

## FV0102

`watch` with `immediate`.

## FV0103

Effect that runs once on the server.

## FV0104

`onServerPrefetch`.

## FV0105

Statement in setup that could change what renders.

## FV0106

`defineAsyncComponent` of anything but a component of this project.

## FV0107

Unsupported statement in setup.

## FV0108

`...rest` in destructured props.

## FV0109

Destructured prop that is not a plain name.

# Constants and enums: FV02xx

## FV0201

Constant that refers to itself.

## FV0202

Enum member without a value after a string member.

## FV0203

Enum member value that is not a string or number literal.

## FV0204

Field a constant object does not have.

## FV0205

Spread or hole in a constant list.

## FV0206

Computed or spread key in a constant object.

## FV0207

Constant that is not a literal.

## FV0208

Constant object read whole.

## FV0209

`null` in a constant list of plain values.

## FV0210

Constant list of plain values of different types.

## FV0211

Constant list mixing plain values and objects.

## FV0212

Two constant lists with one Rust name.

## FV0213

Object in a constant list without a required field.

## FV0214

`null` for a field that is not nullable.

## FV0215

Field of the wrong type in a constant list's object.

## FV0216

Field of an unsupported type in a constant list's objects.

## FV0217

Field that is only ever `null`.

## FV0218

Field `null` in some objects and absent in others.

## FV0219

Field of different types across a constant list's objects.

## FV0220

Constant list's object type declared twice.

## FV0221

Constant list's object type named as a Rust type.

## FV0222

Constant object read by a key chosen at run time.

# Props and types: FV03xx

See [`props`](crate::guide::props).

## FV0301

`generic` that is not a list of type parameters.

## FV0302

Type parameter without a constraint.

A generic component renders each type parameter as its constraint, so `generic="T"` alone gives the server no type. Write `generic="T extends string"`.

## FV0303

Props declared at run time.

## FV0304

Props type not declared in the component.

## FV0305

`defineModel` without a type.

## FV0306

`defineModel` of a nullable type that is not required.

## FV0307

Default for a nullable prop.

## FV0308

Unknown type.

## FV0309

Type that is only `undefined`.

## FV0310

Object type written in place.

## FV0311

Type that may be both `null` and `undefined`.

A Rust `Option` holds one kind of nothing, where JavaScript has two. Declare `T | null` or `x?: T`, never both. See [`props`](crate::guide::props#nullable-props).

## FV0312

Union of different types.

## FV0313

`Record` not keyed by `string`.

## FV0314

Type alias that refers to itself.

## FV0315

Unsupported named type.

## FV0316

Unsupported type.

## FV0317

`Record` of unsupported values.

## FV0318

Interface named as a Rust type.

## FV0319

Type declared in two files.

## FV0320

Interface with members other than plain named fields.

## FV0321

Optional field of a nullable type.

## FV0322

Prop default that is not a literal.

# Templates and attributes: FV04xx

See [`generated_code`](crate::guide::generated_code).

## FV0401

Interpolation of a value that is not a string, a number or a boolean.

## FV0402

Attribute value of an unsupported type.

## FV0403

Attribute bound to a value Vue's server leaves out.

Vue's server renderer leaves out an attribute bound to a list, an object or a `route.query` value, and hydration then sets it to the value's `String()` without reporting a mismatch. Join a list (`.join(",")`) or narrow a query value to one string.

## FV0404

Unsafe attribute name.

## FV0405

Custom directive not listed in `clientDirectives`.

A custom directive's `getSSRProps` may add attributes on the server, which ferrovue does not run. List a directive that adds none in `clientDirectives`.

## FV0406

`$attrs` on a root that takes scope ids.

## FV0407

Attributes that are not an object literal.

## FV0408

Computed or spread key in an attribute object.

## FV0409

`className` bound in place of `class`.

## FV0410

Merged attributes that are not object literals.

## FV0411

Class merged with a string that may repeat the class before it.

## FV0412

Fallthrough attribute of an unsupported type.

## FV0413

`v-model` comparing values of types it cannot compare.

## FV0414

`v-model` over an array.

## FV0415

Value read from `$attrs`.

## FV0416

Root `<Transition>` or `<KeepAlive>` around `v-if` that is given attributes.

## FV0417

Attribute name chosen at run time.

## FV0418

`<component :is>` over a value that is not a closed set.

`<component :is>` compiles to a `match` over its choices, so each one must be known when compiling: an imported component, an HTML element's name, a `computed` or `?:` choosing among them, a prop typed as a union of string literals, or an object of imported components read by such a prop. A `string`, a `Component` or a value from elsewhere could be anything.

## FV0419

`<component :is>` naming something other than an HTML element.

## FV0420

`<component :is>` over a prop that may be absent.

## FV0421

`<component :is>` reading a key its object does not have.

## FV0422

`v-html` or `v-text` on `<component :is>`.

## FV0423

`v-show`, or `v-model` on `<select>`, in content rendered from virtual nodes.

Inside an element `<component :is>` chooses, in the slot content such an element renders, and inside a `<RouterLink>`, Vue's server renders from virtual nodes, where `v-show` writes no `style` while it shows and `v-model` on a `<select>` marks no option `selected`. Bind `:style` or `:selected` yourself.

# Child components: FV05xx

See [`generated_code`](crate::guide::generated_code).

## FV0501

Child component that is not among the compiled components.

## FV0502

Fallthrough attribute that would reach a child's prop.

## FV0503

Child props that are not an object literal.

## FV0504

Computed or spread key in child props.

## FV0505

Attribute named by an integer.

## FV0506

Required prop not passed.

## FV0507

Required nullable prop not passed.

## FV0508

Attributes passed to a child that takes none.

## FV0509

String prop given a value that is not a string.

## FV0510

One type declared separately by parent and child.

## FV0511

Prop given a value of another type.

## FV0512

`Props` imported from a component that is not compiled.

## FV0513

Component resolved by name that is not imported.

# Expressions: FV06xx

## FV0601

Name or function not available on the server.

## FV0602

Unsupported method.

## FV0603

Unsupported call.

## FV0604

Field read on a value that is not an object.

## FV0605

Field the type does not have.

## FV0606

Value that may be absent where its target cannot take it as it is.

## FV0607

Value of an unexpected type.

## FV0608

`+` between unsupported types.

## FV0609

Comparison between unsupported or absent values.

## FV0610

Spread or hole in an array literal.

## FV0611

Array literal of different types.

## FV0612

Computed member access.

## FV0613

Value set up in a way the server cannot evaluate.

## FV0614

Logical operator between values that are not booleans.

## FV0615

`??` falling back to a computed list.

## FV0616

`??` between different types.

## FV0617

`||` between unsupported types.

## FV0618

Unsupported unary operator.

## FV0619

`==` or `!=` with anything but `null` or `undefined`.

## FV0620

Loose test against `undefined` of a value of a plugin's type.

## FV0621

Comparison of a plugin's value with `null` or `undefined`.

## FV0622

`===` between different types.

## FV0623

Branches of `?:` of different types.

## FV0624

`new` in an expression.

## FV0625

Unsupported expression.

## FV0626

Strict test of a value that may be `null` or `undefined`.

## FV0627

Strict test against the absence a value cannot have.

# Strings and numbers: FV07xx

See [`strings`](crate::guide::strings).

## FV0701

`Number()` of an unsupported value.

## FV0702

`parseInt()` or `parseFloat()` of a value that is not a string.

## FV0703

`parseInt()` with a radix other than a literal 10 or 16.

## FV0704

Unsupported `Math` method.

## FV0705

`.toFixed()` without a literal number of digits from 0 to 100.

## FV0706

String that may hold half of a surrogate pair compared, searched or joined.

`slice`, `substring`, `at`, `charAt` and `split("")` can cut a surrogate pair in half. JavaScript keeps the half where ferrovue holds U+FFFD, so two such strings may compare, search or join differently. See [`strings`](crate::guide::strings#halves-of-surrogate-pairs).

## FV0707

`JSON.stringify()` of an unsupported value.

## FV0708

Template literal of values that are not present strings, numbers or booleans.

## FV0709

String method with the wrong number of arguments.

## FV0710

Regular expression given to a string method.

## FV0711

String method given a value that is not a present string.

## FV0712

String method given a value that is not a present number.

## FV0713

Function given to a string method.

## FV0714

`.repeat()` by a negative or infinite count.

## FV0715

Case mapping by the server's locale.

# Lists and loops: FV08xx

See [`props`](crate::guide::props).

## FV0801

`.includes()` of a value of another type than the list's.

## FV0802

`.join()` with a separator that is not a string.

## FV0803

List method on a value that is not a list.

## FV0804

List method over a list of unsupported items.

## FV0805

List method given anything but an arrow function.

## FV0806

Arrow function with a block body.

## FV0807

Arrow function index that is not a plain name.

## FV0808

Defaults or nested patterns in an arrow function's item.

## FV0809

Arrow function item bound by an unsupported pattern.

## FV0810

`.map()` to optional or unsupported values.

## FV0811

`.slice()` with more than two arguments.

## FV0812

`.slice()` of values that are not numbers.

## FV0813

List method given more than one function.

## FV0814

`Object` method of a value that is not a `Record`.

## FV0815

`Object.values()` of a record of lists.

## FV0816

`Object.entries()` outside a `v-for`.

## FV0817

Unsupported `Object` method.

## FV0818

`v-for` over `Object.entries()` without `[key, value]`.

## FV0819

`v-for` over an empty array literal.

## FV0820

`v-for` over a value that is not a list or a number.

## FV0821

Defaults or nested patterns in a `v-for` item.

## FV0822

`v-for` item bound by an unsupported pattern.

## FV0823

`v-for` key or index that is not a plain name.

# Slots: FV09xx

See [`slots`](crate::guide::slots).

## FV0901

Slots that are not an object literal.

## FV0902

Computed or spread slot name.

## FV0903

Content for a slot the child does not have.

## FV0904

Defaults or nested patterns in destructured slot props.

## FV0905

Slot props bound by an unsupported pattern.

## FV0906

Slot props taken from a slot that passes none.

## FV0907

Slot read that the template does not render.

## FV0908

Slot prop of a type with no Rust type.

## FV0909

Array literal as a slot prop.

## FV0910

Computed list as a slot prop.

## FV0911

Slot prop of an unsupported type.

## FV0912

Slot name that is not literal.

## FV0913

Slot props that are not attributes or an object literal.

## FV0914

Computed or spread key in slot props.

## FV0915

Slot prop name that is not a plain name.

## FV0916

Outlets of one slot that pass different props.

## FV0917

Interface named as a slot's props type.

## FV0918

Slot scope id given to content that takes none.

## FV0919

`<slot>` with fallback content inside an element `<component :is>` chooses.

Inside an element that `<component :is>` chooses, Vue renders a slot's content as virtual nodes and decides whether to show the fallback by rules of their own. Give the fallback from the parent instead.

## FV0920

`<slot>` rendered both inside and outside an element `<component :is>` chooses.

# Classes, styles and scoped styles: FV10xx

See [`scoped_styles`](crate::guide::scoped_styles).

## FV1001

Computed or spread key in a class object.

## FV1002

Computed class name that is not a string.

## FV1003

Class name with spaces around it.

## FV1004

Class binding of an unsupported type.

## FV1005

`<style module>`.

## FV1006

`v-bind()` in CSS.

## FV1007

Style binding of an unsupported type.

## FV1008

Computed or spread key in a style object.

## FV1009

Style property named by a number or starting with `:`.

## FV1010

Style array mixing a string with objects.

## FV1011

Style property whose place depends on a condition.

## FV1012

Scope ids handed to a component whose render does not take them.

# Configuration and helpers: FV11xx

See [`quick_start`](crate::guide::quick_start).

## FV1101

Helper called with the wrong number of arguments.

## FV1102

Configuration file not found.

## FV1103

Configuration file that is not valid JSON.

## FV1104

Configuration without `components` or `out`.

## FV1105

Unsupported `scopeId`.

## FV1106

`builders` that is not `true` or `false`.

## FV1107

Unknown helper type.

## FV1108

Imported function without a Rust twin.

## FV1109

Twin name that is not PascalCase.

## FV1110

Twin without `rust`.

## FV1111

Twin prop name that is not camelCase.

## FV1112

Twin slot name that is not a plain name.

# Router: FV12xx

See [`routing`](crate::guide::routing).

## FV1201

Route parameter that is not a present string or number.

## FV1202

`to` that is not a string or an object literal.

## FV1203

Computed or spread key in a `to` object.

## FV1204

Unsupported key in a `to` object.

## FV1205

`query` that is not an object literal.

## FV1206

Computed or spread key in a query.

## FV1207

Query value that may be `null`.

## FV1208

`hash` that is not a string.

## FV1209

Route name that is not a string literal.

## FV1210

Unknown route name.

## FV1211

`params` that is not an object literal.

## FV1212

Computed or spread key in `params`.

## FV1213

Unknown route parameter.

## FV1214

Route parameter not given.

## FV1215

`to` with both `path` and `params`.

## FV1216

`path` that is not a string.

## FV1217

`to` without `name` or `path`.

## FV1218

`<RouterLink>` attributes that are not literal.

## FV1219

Computed or spread key in `<RouterLink>` attributes.

## FV1220

`custom` on `<RouterLink>`.

## FV1221

`href` or `aria-current` set on `<RouterLink>`.

## FV1222

`<RouterLink>` without `to`.

## FV1223

Element in a `<RouterLink>` given a slot scope id.

## FV1224

`<slot>` in a `<RouterLink>` that takes scope ids.

## FV1225

`<RouterLink>` without `routes` configured.

## FV1226

`<RouterLink>` attribute that is not a string literal.

## FV1227

Fallthrough attribute that would reach a `<RouterLink>` prop.

## FV1228

Fallthrough attribute that would replace a `<RouterLink>` attribute.

## FV1229

`<RouterLink>` slot other than the default.

## FV1230

Route read without `routes` configured.

## FV1231

Route field not available on the server.

## FV1232

Routes file that is not an array.

## FV1233

Route entry of an unsupported shape.

## FV1234

`typeof` of anything but a query value.

## FV1235

`??` after a query value with a fallback that is not a string.

## FV1236

`<RouterView>` in a component with `<style scoped>`.

## FV1237

`<RouterView>` in a child component.

## FV1238

`routes` that is neither a routes file nor `{ pages }`.

## FV1239

Pages folder that cannot be read.

## FV1240

Page file name the router cannot match.

Each part of a page's path is plain text (letters, digits, `-` and `_`) or one whole parameter: `[id]`, `[[id]]` (optional) or `[...path]` (a catch-all, last). A parameter beside text in one part (`prefix-[id].vue`), a repeatable parameter (`[id]+`), an optional catch-all (`[[...path]]`), a parameter parser (`[id=int]`) and a character code (`[x+2E]`) are not matched on the server.

## FV1241

Named view in a page file name.

## FV1242

`definePage()` in a page.

`definePage()` changes a page's route (its name, path, alias, meta or params) at build time. ferrovue builds the server's routes from the files' paths alone, so the two would disagree.

## FV1243

`<route>` block in a page.

## FV1244

`_parent.vue` with no pages to hold.

## FV1245

Page whose component name is taken or not a Rust name.

# Pinia stores: FV13xx

See [`pinia`](crate::guide::pinia).

## FV1301

Type declared by two stores.

## FV1302

Store id that is not a string literal.

## FV1303

Store of an unsupported shape.

## FV1304

Store `state` without a declared return type.

## FV1305

Store `getters` that is not an object literal.

## FV1306

Getter that is not a function of the state.

## FV1307

Setup store without a block body.

## FV1308

Unsupported statement in a setup store.

## FV1309

Setup store that does not return an object.

## FV1310

Setup store returning anything but plain names.

## FV1311

Setup store returning a name it does not declare.

## FV1312

Interface named as a setup store's state type.

## FV1313

`ref<T | null>()` without a value.

## FV1314

Setup store `ref` without a type.

## FV1315

Getter with a block body.

## FV1316

Getter that reads `this`.

## FV1317

Getter that returns a function.

## FV1318

Getters that read each other.

## FV1319

Store imported by anything but its `use…` hook.

## FV1320

`storeToRefs` of anything but a store bound in setup.

## FV1321

`storeToRefs` not destructured into plain names.

## FV1322

Store hook called with arguments.

# vue-i18n: FV14xx

See [`i18n`](crate::guide::i18n).

## FV1401

Locale file that is not valid JSON.

## FV1402

Locale message that does not parse.

## FV1403

Linked message with a key chosen at run time.

## FV1404

Linked message with an unknown modifier.

## FV1405

Locale message construct ferrovue does not render.

## FV1406

`t()` value that is not a present string, number or boolean.

## FV1407

`t()` without `i18n` configured.

## FV1408

`t()` with unsupported arguments.

## FV1409

`t()` key that is not a string.

## FV1410

Computed or spread key in `t()`'s named values.

## FV1411

Default message given to `t()`.

## FV1412

Plural number that is not an integer.

## FV1413

`useI18n()` not destructured into plain names.

# Raw HTML, client-only content, teleports and Rust twins: FV15xx

See [`errors_and_limits`](crate::guide::errors_and_limits).

## FV1501

Twin props that are not attributes or an object literal.

## FV1502

`v-html` of anything but a `TrustedHtml` prop.

`v-html` writes raw HTML, which ferrovue allows only from a type you mark as trusted. See [`escaping`](crate::guide::escaping).

## FV1503

`TrustedHtml` prop without `trustedHtml` configured.

## FV1504

Attributes on `<ClientOnly>`.

## FV1505

`<ClientOnly>` slot other than the default and `#fallback`.

## FV1506

Slot props taken from `<ClientOnly>`'s `#fallback`.

## FV1507

`<Teleport>` in slot content whose emptiness is decided at run time.

## FV1508

`<Teleport>` target that is not a string.

## FV1509

Twin prop of a type with no Rust type.

## FV1510

Twin for a component ferrovue compiles.

## FV1511

`<ClientOnly>` with a `#fallback` in content rendered from virtual nodes.

Inside an element `<component :is>` chooses, inside a `<RouterLink>` or a twin's slot, and in the slot content they render, Vue's server renders from virtual nodes, and `<ClientOnly>` writes an empty fragment there instead of its fallback, which the client then renders and reports as a mismatch. Leave out the `#fallback`, or move the `<ClientOnly>` outside that content.

# Provide and inject: FV16xx

See [`provide_inject`](crate::guide::provide_inject).

## FV1601

Injection key that is not a string literal or a symbol exported from a `.ts` file.

## FV1602

Injection key symbol without an `InjectionKey<T>` type.

## FV1603

`provide` or `inject` with unsupported arguments.

## FV1604

`inject` that is not bound to a name at the top of `<script setup>`.

## FV1605

`inject(key)!`, asserting a provider.

## FV1606

`inject` of a string key with neither a default nor a type argument.

## FV1607

Function default without the factory flag.

## FV1608

Values of different types provided under one key.

## FV1609

Provided value that may be `null` or `undefined`.

## FV1610

Provided value of a form the context does not hold.

## FV1611

Object provided or given as a default under a key without an interface type.

## FV1612

Provided or default object whose fields do not match its interface.

## FV1613

Ref and plain value under one key.

## FV1614

Key provided twice by one component.

## FV1615

Two keys that give the context one field name.

## FV1616

`provide` in a component that holds `<RouterView>`.

The page `<RouterView>` shows is rendered from Rust and handed in as a slot, so it cannot see what the component provides. Provide the value above the router (in Rust, through the `Provides` the page is rendered with) or below it.

## FV1617

String-keyed `inject` inside a Rust twin's slot.

Content in a twin's slot is a child of the library component the twin stands for, which may provide the same string key on the client. Use an `InjectionKey` symbol, which only the project provides.

## FV1618

Setup that assigns to an injected value.

## FV1619

Function and value provided under one key.

## FV1620

`provide` or `inject` called inside an expression.

# Page head: FV17xx

See [`head`](crate::guide::head).

## FV1701

Options given to `useHead`.

## FV1702

Head input that is not an object literal.

## FV1703

Head key ferrovue does not translate.

## FV1704

Spread, computed key, hole or method in a head input.

## FV1705

Function in a head input.

unhead calls a function given as a value on the server only when it takes no arguments, as a getter (`title: () => props.title`), which ferrovue evaluates. A `titleTemplate` function and an event handler (`onload`) run with arguments or on the client.

## FV1706

Head value of a type the head does not take.

## FV1707

`tagPosition`, `tagPriority` or `tagDuplicateStrategy` that is not a literal it accepts.

## FV1708

`useHeadSafe`.

## FV1709

`useSeoMeta` key or value ferrovue does not translate.

## FV1710

`class` or `style` in the head that may be `null`.

unhead's server renderer throws on a `class` or `style` of `null`. Write `?? undefined`, which leaves the attribute out.

## FV1711

`innerHTML` or `textContent` on a head tag that has no content.
