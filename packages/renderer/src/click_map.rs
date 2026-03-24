use std::sync::{Mutex, OnceLock};

use crate::layout::Rect;

#[derive(Clone, Debug)]
pub struct ClickRegion {
    pub rect: Rect,
    pub kind: &'static str,
    pub id: String,
}

static CLICK_MAP: OnceLock<Mutex<Vec<ClickRegion>>> = OnceLock::new();

fn map() -> &'static Mutex<Vec<ClickRegion>> {
    CLICK_MAP.get_or_init(|| Mutex::new(Vec::new()))
}

pub fn clear() {
    if let Ok(mut regions) = map().lock() {
        regions.clear();
    }
}

pub fn register(rect: Rect, kind: &'static str, id: String) {
    if let Ok(mut regions) = map().lock() {
        regions.push(ClickRegion { rect, kind, id });
    }
}

pub fn hit(col: u16, row: u16) -> Option<ClickRegion> {
    let guard = map().lock().ok()?;
    for region in guard.iter().rev() {
        if region.rect.contains(col, row) {
            return Some(region.clone());
        }
    }
    None
}
