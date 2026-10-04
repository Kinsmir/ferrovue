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

- Any value reaching the page unescaped where Vue escapes it: text, attributes, the island's
  `data-props`, the state script, `href`s built from routes.
- `v-html` accepting anything but a `TrustedHtml` prop.
- Generated code that can be made to panic or misbehave by props a reader controls.

## Supported versions

Fixes go into the latest release. ferrovue is pre-1.0, so there are no long-term support branches.
