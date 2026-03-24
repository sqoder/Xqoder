#![deny(clippy::all)]

pub mod buffer;
pub mod click_map;
pub mod colors;
pub mod footer_renderer;
pub mod header_renderer;
pub mod hit_test;
pub mod inertia;
pub mod input_renderer;
pub mod layout;
pub mod log_renderer;
pub mod message_index;
pub mod message_renderer;
pub mod mouse;
pub mod overlay_renderer;
pub mod renderer;
pub mod semantics;
pub mod sidebar_renderer;
pub mod text_layout;
pub mod types;
pub mod unicode;
pub mod viewport;

#[cfg(feature = "napi-bindings")]
pub mod bindings;

// Re-export common types for internal use
pub use crate::buffer::{CellStyle, TermColor};
pub use crate::renderer::Renderer;
