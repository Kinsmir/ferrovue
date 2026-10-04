//! `<Teleport>`: content rendered somewhere else on the page.
//!
//! As in Vue's server renderer, a teleport leaves `<!--teleport start-->` and `<!--teleport end-->`
//! where it stands, and its content goes to its target's buffer between anchor comments. The page
//! writes each target's buffer where the target is — a modal container, the end of `<body>` — and
//! the browser hydrates the content there.

use std::cell::RefCell;

/// The teleported content of one render, by target, in the order Vue collects it.
#[derive(Debug, Default)]
pub struct Teleports {
    targets: RefCell<Vec<(String, Vec<String>)>>,
}

impl Teleports {
    /// An empty collector: one per page render.
    pub fn new() -> Teleports {
        Teleports::default()
    }

    /// What was teleported to `target` (`"body"`, `"#modals"`), to write inside that element.
    pub fn get(&self, target: &str) -> Option<String> {
        self.targets
            .borrow()
            .iter()
            .find(|(t, _)| t == target)
            .map(|(_, parts)| parts.concat())
    }

    /// Every target and what was teleported to it, in the order the targets were first used.
    pub fn into_targets(self) -> Vec<(String, String)> {
        self.targets
            .into_inner()
            .into_iter()
            .map(|(t, parts)| (t, parts.concat()))
            .collect()
    }

    /// A place in `target`'s buffer, taken before the content renders, so that teleports nested in it
    /// come after it — as Vue splices it in at the index it had when it started.
    fn reserve(&self, target: &str) -> usize {
        let mut targets = self.targets.borrow_mut();
        let parts = match targets.iter().position(|(t, _)| t == target) {
            Some(i) => &mut targets[i].1,
            None => {
                targets.push((target.to_owned(), Vec::new()));
                &mut targets.last_mut().expect("just pushed").1
            }
        };
        parts.push(String::new());
        parts.len() - 1
    }

    fn fill(&self, target: &str, index: usize, content: String) {
        let mut targets = self.targets.borrow_mut();
        if let Some((_, parts)) = targets.iter_mut().find(|(t, _)| t == target) {
            parts[index] = content;
        }
    }
}

/// `ssrRenderTeleport`: the markers in place and the content in the target's buffer — or, when
/// disabled, the content in place and empty anchors in the target.
pub fn teleport_into(
    out: &mut String,
    teleports: &Teleports,
    target: &str,
    disabled: bool,
    content: &dyn Fn(&mut String),
) {
    out.push_str("<!--teleport start-->");
    let index = teleports.reserve(target);
    if disabled {
        content(out);
        teleports.fill(
            target,
            index,
            "<!--teleport start anchor--><!--teleport anchor-->".to_owned(),
        );
    } else {
        let mut moved = String::from("<!--teleport start anchor-->");
        content(&mut moved);
        moved.push_str("<!--teleport anchor-->");
        teleports.fill(target, index, moved);
    }
    out.push_str("<!--teleport end-->");
}
