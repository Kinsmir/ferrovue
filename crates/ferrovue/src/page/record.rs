use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::task::Waker;

use super::Part;
use crate::json;
use crate::render::{Refused, first};

pub(super) type Shared = Arc<Mutex<Recorded>>;

#[derive(Debug, Default)]
pub(super) struct Recorded {
    pub(super) props: String,
    pub(super) dates: &'static str,
    pub(super) names: Vec<&'static str>,
    pub(super) slots: Vec<(String, Option<String>)>,
    pub(super) open: usize,
    pub(super) waker: Option<Waker>,
    pub(super) refused: Option<Refused>,
}

pub(super) fn lock(record: &Shared) -> MutexGuard<'_, Recorded> {
    record.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Recorded {
    pub(super) fn hold(&mut self, refused: Refused) {
        let held = self.refused.take();
        self.refused = first(held, Err(refused)).err();
    }

    pub(super) fn name(&mut self, parts: &[Part<'_>]) {
        for part in parts {
            if !self.names.contains(&part.name) {
                self.names.push(part.name);
            }
        }
    }

    pub(super) fn to_json(&self) -> String {
        let mut out = String::from("{\"props\":");
        out.push_str(&self.props);
        out.push_str(",\"slots\":{");
        for (i, (name, parts)) in self.slots.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            out.push_str(&json::to_string(name));
            out.push(':');
            out.push_str(parts.as_deref().unwrap_or("[]"));
        }
        out.push('}');
        if !self.dates.is_empty() {
            out.push_str(",\"dates\":");
            out.push_str(self.dates);
        }
        out.push('}');
        out
    }
}

pub(super) fn parts_json(parts: &[Part<'_>]) -> String {
    let mut out = String::from("[");
    for (i, part) in parts.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"c\":");
        out.push_str(&json::to_string(part.name));
        out.push_str(",\"p\":");
        out.push_str(&part.props);
        if !part.dates.is_empty() {
            out.push_str(",\"d\":");
            out.push_str(part.dates);
        }
        out.push('}');
    }
    out.push(']');
    out
}
