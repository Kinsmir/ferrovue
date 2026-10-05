declare const trusted: unique symbol;
declare const inline: unique symbol;
/** HTML already made safe: the only type `v-html` may render. */
export type TrustedHtml = string & { readonly [trusted]: true };

/** Trusted HTML of inline tags only (`ferrovue::InlineHtml` on the server): what `v-html` may render inside a `<p>`. */
export type InlineHtml = TrustedHtml & { readonly [inline]: true };

/** A number that may have a fractional part: an `f64` on the server, where a plain `number` is an `i64`. */
export type Float = number;
