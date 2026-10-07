use std::cell::RefCell;

/// The teleported content of one render, by target, in the order Vue collects it.
///
/// It is not `Sync`: give each render its own.
///
/// # Example
///
/// ```
/// use ferrovue::{teleport_into, Teleports};
///
/// let teleports = Teleports::new();
/// let mut body = String::new();
/// // What a generated component writes for `<Teleport to="#modals"><p>hi</p></Teleport>`.
/// teleport_into(&mut body, &teleports, "#modals", false, &|out: &mut String| out.push_str("<p>hi</p>"));
///
/// assert_eq!(body, "<!--teleport start--><!--teleport end-->");
/// let modals = teleports.get("#modals").unwrap_or_default();
/// assert_eq!(modals, "<!--teleport start anchor--><p>hi</p><!--teleport anchor-->");
/// // The page then writes `<div id="modals">{modals}</div>`.
/// ```
#[derive(Debug, Default)]
pub struct Teleports {
    targets: RefCell<Vec<(String, Vec<String>)>>,
}

impl Teleports {
    /// An empty collector: one per page render.
    ///
    /// # Example
    ///
    /// ```
    /// let teleports = ferrovue::Teleports::new();
    /// assert_eq!(teleports.get("#modals"), None);
    /// ```
    #[must_use]
    pub fn new() -> Teleports {
        Teleports::default()
    }

    /// What was teleported to `target` (`"body"`, `"#modals"`), to write inside that element;
    /// `None` when nothing was. `target` is the `to` exactly as the template wrote it.
    ///
    /// # Example
    ///
    /// ```
    /// use ferrovue::{teleport_into, Teleports};
    ///
    /// let teleports = Teleports::new();
    /// let mut body = String::new();
    /// teleport_into(&mut body, &teleports, "#modals", false, &|out: &mut String| out.push_str("a"));
    /// teleport_into(&mut body, &teleports, "#modals", false, &|out: &mut String| out.push_str("b"));
    /// // Both, in the order they rendered.
    /// assert_eq!(
    ///     teleports.get("#modals").unwrap(),
    ///     "<!--teleport start anchor-->a<!--teleport anchor--><!--teleport start anchor-->b<!--teleport anchor-->"
    /// );
    /// assert_eq!(teleports.get("#other"), None);
    /// ```
    #[must_use]
    pub fn get(&self, target: &str) -> Option<String> {
        self.targets
            .borrow()
            .iter()
            .find(|(t, _)| t == target)
            .map(|(_, parts)| parts.concat())
    }

    /// Every target and what was teleported to it, in the order the targets were first used.
    ///
    /// # Example
    ///
    /// ```
    /// use ferrovue::{teleport_into, Teleports};
    ///
    /// let teleports = Teleports::new();
    /// let mut body = String::new();
    /// teleport_into(&mut body, &teleports, "#overlay", false, &|out: &mut String| out.push_str("o"));
    /// teleport_into(&mut body, &teleports, "#modals", false, &|out: &mut String| out.push_str("m"));
    ///
    /// let targets: Vec<String> = teleports.into_targets().into_iter().map(|(target, _)| target).collect();
    /// assert_eq!(targets, ["#overlay", "#modals"]);
    /// ```
    #[must_use]
    pub fn into_targets(self) -> Vec<(String, String)> {
        self.targets
            .into_inner()
            .into_iter()
            .map(|(t, parts)| (t, parts.concat()))
            .collect()
    }

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

/// `ssrRenderTeleport`: the markers in place and the content in the target's buffer, or, when
/// disabled, the content in place and empty anchors in the target.
///
/// # Example
///
/// ```
/// use ferrovue::{teleport_into, Teleports};
///
/// let teleports = Teleports::new();
/// let mut out = String::new();
/// // `<Teleport to="#modals" disabled>`: the content stays where it is.
/// teleport_into(&mut out, &teleports, "#modals", true, &|out: &mut String| out.push_str("<p>here</p>"));
/// assert_eq!(out, "<!--teleport start--><p>here</p><!--teleport end-->");
/// assert_eq!(
///     teleports.get("#modals").unwrap(),
///     "<!--teleport start anchor--><!--teleport anchor-->"
/// );
/// ```
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

#[cfg(test)]
mod tests;
