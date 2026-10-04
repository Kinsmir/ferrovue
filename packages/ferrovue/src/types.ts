/* The types a component imports from `ferrovue/types`.
 *
 * `TrustedHtml` is what `v-html` may render. The compiler accepts `v-html` only on a prop declared
 * with this type, imported from this module, and the project's configuration says which Rust type it
 * is on the server — one that implements `ferrovue::TrustedHtml`, and so can only hold HTML that has
 * already been made safe. In the browser it is a string; the brand only stops a plain `string` being
 * passed where trusted HTML is expected.
 *
 * `Float` is a number that may have a fractional part, an `f64` on the server. A plain `number` is an
 * integer there (`i64`), which is what most props — counts, ids, indexes — are. */
declare const trusted: unique symbol;
export type TrustedHtml = string & { readonly [trusted]: true };

export type Float = number;
