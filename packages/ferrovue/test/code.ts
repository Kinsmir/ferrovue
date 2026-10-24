const FIXED = new Set(["fv_route", "fv_link", "fv_provides", "fv_slots", "fv_loads", "fv_head", "fv_attrs", "fv_search", "fv_merged", "fv_inherited", "fv_stores", "fv_sp", "fv_refusals", "fv_teleports", "fv_sid", "fv_chunk"]);

const LOCAL = /\b(?:n\d+|fv_[a-z_]+\d*|s_[a-z_]+|[a-z]{1,2}\d*(?:_ref|_cow)?)\b/g;

/** A pattern of Rust the compiler writes, matching it whatever names the compiler gives its locals:
 * each name in `rust` that may be one is read as any name. */
export function like(rust: string, whole = false): RegExp {
  let out = "";
  let at = 0;
  for (const m of rust.matchAll(LOCAL)) {
    if (FIXED.has(m[0])) continue;
    out += rust.slice(at, m.index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out += "[A-Za-z_]\\w*";
    at = m.index + m[0].length;
  }
  out += rust.slice(at).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(whole ? `^${out}$` : out);
}
