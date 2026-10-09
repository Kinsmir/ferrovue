# Security policy

ferrovue writes HTML that reaches browsers, so a flaw in its escaping is a cross-site scripting
hole in every site that uses it. Please report one privately.

## Reporting a vulnerability

Use GitHub's private reporting: [open a security advisory](https://github.com/Kinsmir/ferrovue/security/advisories/new).
Please do not open a public issue for it.

Include the component, the props it was rendered with, and the HTML ferrovue wrote. You can expect
a first response within a week, and a fix released as soon as it is ready, with credit in the
advisory unless you would rather not be named.

## What counts

The guide's [threat model](https://docs.rs/ferrovue/latest/ferrovue/guide/security/index.html)
(`crates/ferrovue/docs/guide/security.md`) lists every place ferrovue writes data that may come from
a reader, what it guarantees there, and what it inherits from Vue. A break of any guarantee it
states counts, in particular:

- Any value reaching the page unescaped where Vue escapes it: text, attributes, the island's
  `data-props`, the state script and the page record, `href`s built from routes, the page head.
- An attribute name taken from data.
- A value that adds or moves a streaming hole.
- `v-html` accepting anything but a `TrustedHtml` prop, or `BasicHtml`, `InlineHtml` or `Sanitised`
  holding markup their rules leave out.
- Generated code that can be made to panic or misbehave by props a reader controls.

What the threat model lists as inherited from Vue (a `javascript:` URL bound to `href`, `srcdoc`, an
`onclick` attribute bound to a value, CSS in `style`) is Vue's behaviour, which ferrovue reproduces
on purpose.

## Supported versions

Fixes go into the latest release. ferrovue is pre-1.0, so there are no long-term support branches.
