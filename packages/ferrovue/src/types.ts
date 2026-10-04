/* The types a component imports from `ferrovue/types`.
 *
 * `TrustedHtml` is what `v-html` may render. The compiler accepts `v-html` only on a prop declared
 * with this type, imported from this module, and the project's configuration says which Rust type it
 * is on the server — one that implements `ferrovue::TrustedHtml`, and so can only hold HTML that has
 * already been made safe. In the browser it is a string; the brand only stops a plain `string` being
 * passed where trusted HTML is expected. */
declare const trusted: unique symbol;
export type TrustedHtml = string & { readonly [trusted]: true };
