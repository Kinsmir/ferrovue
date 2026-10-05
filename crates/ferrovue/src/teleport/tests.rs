use super::*;

#[test]
fn teleported_content_goes_to_its_target_in_the_order_vue_collects_it() {
    let teleports = Teleports::new();
    let mut out = String::from("<main>");
    teleport_into(
        &mut out,
        &teleports,
        "#modals",
        false,
        &|out: &mut String| {
            out.push_str("<div>outer");
            // Nested: it comes after the outer teleport, which took its place first.
            teleport_into(out, &teleports, "#modals", false, &|out: &mut String| {
                out.push_str("<p>inner</p>")
            });
            out.push_str("</div>");
        },
    );
    teleport_into(&mut out, &teleports, "body", true, &|out: &mut String| {
        out.push_str("<i>here</i>")
    });
    out.push_str("</main>");
    assert_eq!(
        out,
        "<main><!--teleport start--><!--teleport end--><!--teleport start--><i>here</i><!--teleport end--></main>"
    );
    assert_eq!(
        teleports.get("#modals").unwrap(),
        "<!--teleport start anchor--><div>outer<!--teleport start--><!--teleport end--></div><!--teleport anchor--><!--teleport start anchor--><p>inner</p><!--teleport anchor-->"
    );
    assert_eq!(
        teleports.get("body").unwrap(),
        "<!--teleport start anchor--><!--teleport anchor-->"
    );
    assert_eq!(teleports.into_targets().len(), 2);
}
