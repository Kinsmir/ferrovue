/** The HTML elements a browser lays out as blocks, list items, table parts or nothing, and `<br>`:
 * the whitespace beside them does not show. */
export const SPACELESS_TAGS = new Set(
  [
    "address article aside blockquote body br caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form",
    "h1 h2 h3 h4 h5 h6 head header hgroup hr html legend li link listing main menu meta nav noscript ol optgroup option p param plaintext pre",
    "script search section source style summary table tbody td template tfoot th thead title tr track ul xmp area base basefont datalist noembed noframes rp",
  ]
    .join(" ")
    .split(" "),
);
