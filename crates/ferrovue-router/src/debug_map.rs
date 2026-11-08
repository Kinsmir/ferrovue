pub(crate) struct DebugMap<I>(pub(crate) I);

impl<K: std::fmt::Debug, V: std::fmt::Debug, I: Iterator<Item = (K, V)> + Clone> std::fmt::Debug
    for DebugMap<I>
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_map().entries(self.0.clone()).finish()
    }
}
