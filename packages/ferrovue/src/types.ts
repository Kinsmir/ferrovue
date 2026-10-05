declare const trusted: unique symbol;
/** HTML already made safe: the only type `v-html` may render. */
export type TrustedHtml = string & { readonly [trusted]: true };

/** A number that may have a fractional part: an `f64` on the server, where a plain `number` is an `i64`. */
export type Float = number;
