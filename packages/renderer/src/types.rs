// ============================================================
// Pure Rust Rendering Types (NAPI-Independent)
// ============================================================

#[derive(Debug, Clone, Copy, Default)]
pub struct LayoutRect {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}

pub struct TuiLayout {
    pub header: LayoutRect,
    pub messages: LayoutRect,
    pub messages_scrollbar: Option<LayoutRect>,
    pub input: LayoutRect,
    pub footer: LayoutRect,
    pub sidebar: LayoutRect,
    pub has_sidebar: bool,
    pub overlay: Option<LayoutRect>,
}

#[derive(Clone)]
pub struct MessagePart {
    pub kind: String,
    pub content: Option<String>,
    pub tool_name: Option<String>,
    pub status: Option<String>,
    pub summary: Option<String>,
    pub collapsed: Option<bool>,
    pub items: Option<Vec<String>>,
    pub action_id: Option<String>,
    pub step_index: Option<u16>,
    pub step_total: Option<u16>,
    pub label: Option<String>,
}

#[derive(Clone)]
pub struct Message {
    pub id: String,
    pub role: String,
    pub parts: Vec<MessagePart>,
    pub timestamp: f64,
}

pub struct TuiInputState {
    pub parts: Vec<crate::input_renderer::InputPart>,
    pub cursor_grapheme: u32,
    pub mode: String,
}

pub struct TuiSidebarState {
    pub session_id: String,
    pub cwd: String,
    pub model: String,
    pub agent: String,
    pub mode: String,
    pub context_used: u32,
    pub context_max: u32,
    pub cost_usd_this: f64,
    pub cost_usd_today: f64,
    pub today_messages: u32,
    pub lsp_lines: Vec<String>,
    pub docker_lines: Vec<String>,
    pub docker_url: String,
}

pub struct TuiStatusState {
    pub thinking: bool,
    pub text: String,
}

pub struct TuiScrollState {
    pub offset_lines: u32,
    pub max_scroll_y: u32,
    pub content_lines: u32,
    pub sticky_bottom: bool,
    pub dragging_scrollbar: bool,
}

pub struct TuiOverlayState {
    pub kind: String,
    pub items: Vec<String>,
    pub selected_index: i32,
    pub scroll_offset: u32,
    pub max_width: Option<u16>,
}

pub struct InputStyledSegment {
    pub text: String,
    pub tone: String,
}

pub struct InputStyledLine {
    pub segments: Vec<InputStyledSegment>,
}

pub struct InputLayoutResult {
    pub lines: Vec<String>,
    pub styled_lines: Vec<InputStyledLine>,
    pub cursor_line: u16,
    pub cursor_col: u16,
    pub border_tone: String,
    pub border_glyph: String,
    pub mode_chip_text: String,
    pub mode_chip_tone: String,
    pub prompt_first: String,
    pub prompt_continuation: String,
    pub content_offset_first: u16,
    pub content_offset_continuation: u16,
    pub corner_tl: String,
    pub corner_tr: String,
    pub corner_bl: String,
    pub corner_br: String,
    pub side_glyph: String,
    pub is_placeholder: bool,
}

pub struct HitTargetResult {
    pub kind: String,
    pub line_offset: Option<u16>,
    pub row: Option<u16>,
    pub ratio: Option<f64>,
    pub index: Option<i32>,
    pub id: Option<String>,
}

pub struct TuiState {
    pub page: String,
    pub log_lines: Vec<String>,
    pub messages: Vec<Message>,
    pub input: TuiInputState,
    pub sidebar: TuiSidebarState,
    pub status: TuiStatusState,
    pub scroll: TuiScrollState,
    pub layout: TuiLayout,
    pub overlay: Option<TuiOverlayState>,
    pub tick: u32,
    pub blink: bool,
}
