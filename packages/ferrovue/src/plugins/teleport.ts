import { type Component, fail } from "../model.ts";
import { expr } from "../expr.ts";
import { cond } from "../narrowing.ts";
import { bare, strArg } from "../parens.ts";
import { statements } from "../template.ts";
import { type Plugin, runOf } from "../plugin.ts";

type TeleportRun = Set<Component>;

export const teleport: Plugin<TeleportRun> = {
  name: "teleport",
  configure: () => new Set(),
  compiled(comp, code) {
    if (code.includes("_ssrRenderTeleport(")) runOf(teleport).add(comp);
  },
  statement(s, e, c, st) {
    if (c.callee.type !== "Identifier" || c.callee.name !== "_ssrRenderTeleport") return false;
    const [, content, target, disabled] = c.arguments;
    if (s.fill) fail(s.comp, "FV1507", "a `<Teleport>` in slot content whose emptiness is decided at run time", st);
    const to = expr(s, target);
    if (to.ty.k !== "str") fail(s.comp, "FV1508", "a `<Teleport>`'s `to` is a string", target);
    const off = disabled ? bare(cond(s, disabled)) : "false";
    if (content?.type !== "ArrowFunctionExpression" || content.body.type !== "BlockStatement") fail(s.comp, "FV0006", "unexpected `<Teleport>` content", st);
    e.open(`fv::teleport_into(out, fv_teleports, ${strArg(to.code)}, ${off}, &|out: &mut String|`);
    statements(s, e, content.body.body);
    e.close(");");
    return true;
  },
  params: [
    {
      name: "fv_teleports",
      ty: "&fv::Teleports",
      pageTy: "&'p fv::Teleports",
      reads: (c) => runOf(teleport).has(c),
      test: { lines: ["let teleports = ferrovue::Teleports::new();"], arg: "&teleports", after: ["teleports_into(&mut out, teleports);"] },
      testSupport: `/// What was teleported, after a marker, as the conformance suite writes Vue's: \`{"target":"…"}\`.
#[cfg(test)]
fn teleports_into(out: &mut String, teleports: ferrovue::Teleports) {
    let targets = teleports.into_targets();
    if targets.is_empty() {
        return;
    }
    let pairs: Vec<String> = targets
        .iter()
        .map(|(t, html)| format!("{}:{}", serde_json::to_string(t).unwrap(), serde_json::to_string(html).unwrap()))
        .collect();
    out.push_str("<!--fv-teleports-->{");
    out.push_str(&pairs.join(","));
    out.push('}');
}`,
    },
  ],
};
