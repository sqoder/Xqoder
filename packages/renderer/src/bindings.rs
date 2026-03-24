use crate::buffer::{CellStyle as RustCellStyle, TermColor};
use crossterm::terminal;
use napi_derive::napi;
use std::sync::{Arc, Mutex};

#[napi(object)]
#[derive(Clone, Default)]
pub struct CellStyle {
    pub fg: Option<String>,
    pub bg: Option<String>,
    pub bold: Option<bool>,
    pub dim: Option<bool>,
    pub italic: Option<bool>,
    pub underline: Option<bool>,
    pub strikethrough: Option<bool>,
}

#[napi(object)]
pub struct MouseEvent {
    pub kind: String,
    pub button: String,
    pub col: u16,
    pub row: u16,
    pub shift: bool,
    pub alt: bool,
    pub ctrl: bool,
    pub velocity: f64,
}

#[napi(object)]
#[derive(Clone, Copy)]
pub struct LayoutRect {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}

#[napi(object)]
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

#[napi(object)]
pub struct ViewportRange {
    pub start_line: u32,
    pub end_line: u32,
}

#[napi(object)]
pub struct ScrollbarThumb {
    pub visible: bool,
    pub thumb_top: u32,
    pub thumb_height: u32,
    pub track_height: u32,
}

#[napi(object)]
pub struct EntryHeightCache {
    pub heights: Vec<u32>,
    pub cum_heights: Vec<u32>,
    pub total_lines: u32,
}

#[napi(object)]
pub struct HitTargetResult {
    pub kind: String,
    pub line_offset: Option<u16>,
    pub row: Option<u16>,
    pub ratio: Option<f64>,
    pub index: Option<i32>,
    pub id: Option<String>,
}

#[napi(object)]
pub struct MessageHeightsResult {
    pub heights: Vec<u32>,
    pub cum_heights: Vec<u32>,
    pub total_lines: u32,
}

#[napi(object)]
pub struct VisibleMessageRangeResult {
    pub start_index: u32,
    pub start_line_offset: u16,
    pub end_index: u32,
}

#[napi(object)]
pub struct InputPartSpec {
    pub kind: String,
    pub content: Option<String>,
    pub display: Option<String>,
    pub agent_id: Option<String>,
    pub word_count: Option<u32>,
    pub index: Option<u32>,
}

#[napi(object)]
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

#[napi(object)]
pub struct InputStyledSegment {
    pub text: String,
    pub tone: String,
}

#[napi(object)]
pub struct InputStyledLine {
    pub segments: Vec<InputStyledSegment>,
}

#[napi(object)]
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

#[napi(object)]
pub struct Message {
    pub id: String,
    pub role: String,
    pub parts: Vec<MessagePart>,
    pub timestamp: f64,
}

#[napi(object)]
pub struct TuiState {
    pub page: String,
    pub log_lines: Vec<String>,
    pub messages: Option<Vec<Message>>,
    pub input: TuiInputState,
    pub sidebar: TuiSidebarState,
    pub status: TuiStatusState,
    pub scroll: TuiScrollState,
    pub layout: TuiLayout,
    pub overlay: Option<TuiOverlayState>,
    pub tick: u32,
    pub blink: bool,
}

#[napi(object)]
pub struct TuiOverlayState {
    pub kind: String,
    pub items: Vec<String>,
    pub selected_index: i32,
    pub scroll_offset: u32,
    pub max_width: Option<u16>,
}

#[napi(object)]
pub struct TuiInputState {
    pub parts: Vec<InputPartSpec>,
    pub cursor_grapheme: u32,
    pub mode: String,
}

#[napi(object)]
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

#[napi(object)]
pub struct TuiStatusState {
    pub thinking: bool,
    pub text: String,
}

#[napi(object)]
pub struct TuiScrollState {
    pub offset_lines: u32,
    pub max_scroll_y: u32,
    pub content_lines: u32,
    pub sticky_bottom: bool,
    pub dragging_scrollbar: bool,
}

#[napi]
pub struct XqRenderer {
    inner: crate::renderer::Renderer,
    mouse_physics: Arc<Mutex<crate::mouse::ScrollPhysics>>,
    active_page: Arc<Mutex<String>>,
    messages: Arc<Mutex<Vec<crate::types::Message>>>,
    message_total_lines: Arc<Mutex<Option<(usize, u32)>>>,
    message_scroll_offset_lines: Arc<Mutex<u32>>,
    message_follow_bottom: Arc<Mutex<bool>>,
    message_max_scroll_y: Arc<Mutex<u32>>,
    log_scroll_offset_lines: Arc<Mutex<u32>>,
    log_follow_bottom: Arc<Mutex<bool>>,
    log_max_scroll_y: Arc<Mutex<u32>>,
    dragging_scrollbar: Arc<Mutex<bool>>,
}

const AUTO_FOLLOW_THRESHOLD_LINES: u32 = 3;

fn js_mouse_event_to_internal(event: MouseEvent) -> crate::mouse::MouseEvent {
    let kind = match event.kind.as_str() {
        "press" => crate::mouse::MouseEventKind::Press,
        "release" => crate::mouse::MouseEventKind::Release,
        "move" => crate::mouse::MouseEventKind::Move,
        "scroll_up" => crate::mouse::MouseEventKind::ScrollUp,
        "scroll_down" => crate::mouse::MouseEventKind::ScrollDown,
        _ => crate::mouse::MouseEventKind::Move,
    };

    let button = match event.button.as_str() {
        "left" => crate::mouse::MouseButton::Left,
        "middle" => crate::mouse::MouseButton::Middle,
        "right" => crate::mouse::MouseButton::Right,
        _ => crate::mouse::MouseButton::None,
    };

    crate::mouse::MouseEvent {
        kind,
        button,
        col: event.col,
        row: event.row,
        shift: event.shift,
        alt: event.alt,
        ctrl: event.ctrl,
    }
}

fn reconcile_scroll_state(
    offset_state: &Arc<Mutex<u32>>,
    follow_state: &Arc<Mutex<bool>>,
    max_state: &Arc<Mutex<u32>>,
    total_lines: u32,
    visible_height: u32,
) -> (u32, bool, u32) {
    let max_top_line = total_lines.saturating_sub(visible_height);
    let mut offset = *offset_state.lock().expect("scroll offset lock poisoned");
    let mut follow_bottom = *follow_state.lock().expect("scroll follow lock poisoned");

    if offset.saturating_add(AUTO_FOLLOW_THRESHOLD_LINES) >= max_top_line {
        follow_bottom = true;
    }

    if follow_bottom {
        offset = max_top_line;
    } else {
        offset = offset.min(max_top_line);
    }

    *offset_state.lock().expect("scroll offset lock poisoned") = offset;
    *follow_state.lock().expect("scroll follow lock poisoned") = follow_bottom;
    *max_state.lock().expect("scroll max lock poisoned") = max_top_line;
    (offset, follow_bottom, max_top_line)
}

fn apply_scroll_delta(
    offset_state: &Arc<Mutex<u32>>,
    follow_state: &Arc<Mutex<bool>>,
    max_state: &Arc<Mutex<u32>>,
    delta: i32,
) {
    let mut offset = offset_state.lock().expect("scroll offset lock poisoned");
    let mut follow_bottom = follow_state.lock().expect("scroll follow lock poisoned");
    let max_y = *max_state.lock().expect("scroll max lock poisoned");
    if delta == 0 {
        return;
    }
    if delta < 0 {
        *follow_bottom = false;
        *offset = offset.saturating_sub((-delta) as u32);
        return;
    }
    *offset = offset.saturating_add(delta as u32).min(max_y);
    if offset.saturating_add(AUTO_FOLLOW_THRESHOLD_LINES) >= max_y {
        *follow_bottom = true;
    }
}

fn move_scroll_home(offset_state: &Arc<Mutex<u32>>, follow_state: &Arc<Mutex<bool>>) {
    *offset_state.lock().expect("scroll offset lock poisoned") = 0;
    *follow_state.lock().expect("scroll follow lock poisoned") = false;
}

fn move_scroll_to_bottom(follow_state: &Arc<Mutex<bool>>) {
    *follow_state.lock().expect("scroll follow lock poisoned") = true;
}

fn set_scroll_top_line(
    offset_state: &Arc<Mutex<u32>>,
    follow_state: &Arc<Mutex<bool>>,
    max_state: &Arc<Mutex<u32>>,
    top_line: u32,
) {
    let mut offset = offset_state.lock().expect("scroll offset lock poisoned");
    let mut follow_bottom = follow_state.lock().expect("scroll follow lock poisoned");
    let max_y = *max_state.lock().expect("scroll max lock poisoned");
    *offset = top_line.min(max_y);
    *follow_bottom = offset.saturating_add(AUTO_FOLLOW_THRESHOLD_LINES) >= max_y;
}

impl XqRenderer {
    fn handle_mouse_event_internal(
        &self,
        event: crate::mouse::MouseEvent,
        input_lines: u16,
    ) -> bool {
        let (cols, rows) = terminal::size().unwrap_or((80, 24));
        let layout = crate::layout::compute_layout(cols, rows, input_lines, None, None);
        let hit = crate::hit_test::hit_test(event.col, event.row, &layout);
        let active_page = self.active_page.lock().expect("active page lock").clone();
        let (offset_state, follow_state, max_state) = if active_page == "logs" {
            (
                &self.log_scroll_offset_lines,
                &self.log_follow_bottom,
                &self.log_max_scroll_y,
            )
        } else {
            (
                &self.message_scroll_offset_lines,
                &self.message_follow_bottom,
                &self.message_max_scroll_y,
            )
        };
        let mut offset = offset_state.lock().expect("offset lock");
        let mut follow_bottom = follow_state.lock().expect("follow lock");
        let max_y = *max_state.lock().expect("max_y lock");
        let mut dragging = self.dragging_scrollbar.lock().expect("dragging lock");

        match event.kind {
            crate::mouse::MouseEventKind::ScrollUp => {
                *follow_bottom = false;
                *offset = offset.saturating_sub(3);
                true
            }
            crate::mouse::MouseEventKind::ScrollDown => {
                *offset = offset.saturating_add(3).min(max_y);
                if offset.saturating_add(AUTO_FOLLOW_THRESHOLD_LINES) >= max_y {
                    *follow_bottom = true;
                }
                true
            }
            crate::mouse::MouseEventKind::Press => {
                if let crate::hit_test::HitTarget::Scrollbar { ratio } = hit {
                    if event.button == crate::mouse::MouseButton::Left {
                        *dragging = true;
                        *follow_bottom = false;
                        *offset = (ratio as f64 * max_y as f64).round() as u32;
                        return true;
                    }
                }
                false
            }
            crate::mouse::MouseEventKind::Move => {
                if *dragging {
                    if let crate::hit_test::HitTarget::Scrollbar { ratio } = hit {
                        *offset = (ratio as f64 * max_y as f64).round() as u32;
                    } else if let Some(sb) = layout.messages_scrollbar {
                        let rel_y = event.row.saturating_sub(sb.y) as f64;
                        let ratio = (rel_y / (sb.height as f64)).clamp(0.0, 1.0);
                        *offset = (ratio * (max_y as f64)) as u32;
                    }
                    true
                } else {
                    false
                }
            }
            crate::mouse::MouseEventKind::Release => {
                if *dragging {
                    *dragging = false;
                    true
                } else {
                    false
                }
            }
        }
    }
}

#[napi]
impl XqRenderer {
    #[napi(constructor)]
    pub fn new(cols: u16, rows: u16) -> Self {
        Self {
            inner: crate::renderer::Renderer::new(cols, rows, 60),
            mouse_physics: Arc::new(Mutex::new(crate::mouse::ScrollPhysics::default())),
            active_page: Arc::new(Mutex::new("chat".to_string())),
            messages: Arc::new(Mutex::new(Vec::new())),
            message_total_lines: Arc::new(Mutex::new(None)),
            message_scroll_offset_lines: Arc::new(Mutex::new(0)),
            message_follow_bottom: Arc::new(Mutex::new(true)),
            message_max_scroll_y: Arc::new(Mutex::new(0)),
            log_scroll_offset_lines: Arc::new(Mutex::new(0)),
            log_follow_bottom: Arc::new(Mutex::new(true)),
            log_max_scroll_y: Arc::new(Mutex::new(0)),
            dragging_scrollbar: Arc::new(Mutex::new(false)),
        }
    }

    #[napi(js_name = "writeText")]
    pub fn write_text(&self, col: u16, row: u16, text: String, style: CellStyle) {
        self.inner
            .write_text(col, row, &text, js_style_to_rust(&style));
    }

    #[napi(js_name = "clearLine")]
    pub fn clear_line(&self, row: u16) {
        self.inner.clear_line(row);
    }

    #[napi]
    pub fn clear(&self) {
        self.inner.clear();
    }

    #[napi]
    pub fn invalidate(&self) {
        self.inner.invalidate();
    }

    #[napi]
    pub fn resize(&self, cols: u16, rows: u16) {
        self.inner.resize(cols, rows);
    }

    #[napi(js_name = "stringWidth")]
    pub fn string_width(&self, text: String) -> u32 {
        crate::unicode::string_display_width(&text) as u32
    }

    #[napi(js_name = "truncateToWidth")]
    pub fn truncate_to_width(&self, text: String, max_width: u32) -> String {
        crate::unicode::truncate_to_width(&text, max_width as usize)
    }

    #[napi(js_name = "parseMouse")]
    pub fn parse_mouse(&self, seq: String) -> Option<MouseEvent> {
        let event = crate::mouse::parse_sgr_mouse(&seq)?;
        let velocity = if matches!(
            event.kind,
            crate::mouse::MouseEventKind::ScrollUp | crate::mouse::MouseEventKind::ScrollDown
        ) {
            let dir = if event.kind == crate::mouse::MouseEventKind::ScrollUp {
                1.0
            } else {
                -1.0
            };
            self.mouse_physics
                .lock()
                .expect("mouse physics lock poisoned")
                .tick(dir) as f64
        } else {
            0.0
        };

        let kind = match event.kind {
            crate::mouse::MouseEventKind::Press => "press",
            crate::mouse::MouseEventKind::Release => "release",
            crate::mouse::MouseEventKind::Move => "move",
            crate::mouse::MouseEventKind::ScrollUp => "scroll_up",
            crate::mouse::MouseEventKind::ScrollDown => "scroll_down",
        }
        .to_string();

        let button = match event.button {
            crate::mouse::MouseButton::Left => "left",
            crate::mouse::MouseButton::Middle => "middle",
            crate::mouse::MouseButton::Right => "right",
            crate::mouse::MouseButton::None => "none",
        }
        .to_string();

        Some(MouseEvent {
            kind,
            button,
            col: event.col,
            row: event.row,
            shift: event.shift,
            alt: event.alt,
            ctrl: event.ctrl,
            velocity,
        })
    }

    #[napi(js_name = "mouseEnableAnsi")]
    pub fn mouse_enable_ansi(&self) -> String {
        crate::mouse::MOUSE_ENABLE.to_string()
    }

    #[napi(js_name = "mouseDisableAnsi")]
    pub fn mouse_disable_ansi(&self) -> String {
        crate::mouse::MOUSE_DISABLE.to_string()
    }

    #[napi(js_name = "decayScroll")]
    pub fn decay_scroll(&self) -> f64 {
        self.mouse_physics
            .lock()
            .expect("mouse physics lock poisoned")
            .decay() as f64
    }

    #[napi(js_name = "resetScroll")]
    pub fn reset_scroll(&self) {
        self.mouse_physics
            .lock()
            .expect("mouse physics lock poisoned")
            .reset();
    }

    #[napi(js_name = "scrollVelocity")]
    pub fn scroll_velocity(&self) -> f64 {
        self.mouse_physics
            .lock()
            .expect("mouse physics lock poisoned")
            .velocity() as f64
    }

    #[napi(js_name = "commitState")]
    pub fn commit_state(&self, state: TuiState) {
        let mut state = state;
        *self.active_page.lock().expect("active page lock poisoned") = state.page.clone();
        let (real_cols_raw, real_rows_raw) = terminal::size().unwrap_or((0, 0));
        let real_cols = real_cols_raw;
        let real_rows = real_rows_raw.saturating_sub(1).max(1);

        // 估算输入框行数（与 TS 侧 run-terminal-app-core.ts 保持大体一致）
        let input_val = &state.input.parts;
        let mut input_lines = 1u16;
        for p in input_val {
            if let Some(c) = &p.content {
                input_lines = input_lines.max(c.lines().count() as u16);
            }
        }
        let input_lines = input_lines.clamp(1, 6) + 1; // +1 为 Border/Margin 留白

        let overlay_item_count = state.overlay.as_ref().map(|o| o.items.len() as u16);
        let overlay_max_width = state.overlay.as_ref().and_then(|o| o.max_width);

        let layout = if real_cols > 0 && real_rows > 0 {
            crate::layout::compute_layout(
                real_cols,
                real_rows,
                input_lines,
                overlay_item_count,
                overlay_max_width,
            )
        } else {
            crate::layout::compute_layout(
                80,
                24,
                input_lines,
                overlay_item_count,
                overlay_max_width,
            )
        };

        let visible_height = layout.messages.height as u32;
        let content_w = layout.messages.width.saturating_sub(2).max(1) as usize;

        // --- 转换逻辑 ---
        let incoming_messages = state.messages.take();
        let messages_updated = incoming_messages.is_some();
        let rust_messages: Vec<crate::types::Message> = if let Some(messages) = incoming_messages {
            let converted: Vec<crate::types::Message> = messages
                .iter()
                .map(|m| crate::types::Message {
                    id: m.id.clone(),
                    role: m.role.clone(),
                    parts: m
                        .parts
                        .iter()
                        .map(|p| crate::types::MessagePart {
                            kind: p.kind.clone(),
                            content: p.content.clone(),
                            tool_name: p.tool_name.clone(),
                            status: p.status.clone(),
                            summary: p.summary.clone(),
                            collapsed: p.collapsed,
                            items: p.items.clone(),
                            action_id: p.action_id.clone(),
                            step_index: p.step_index,
                            step_total: p.step_total,
                            label: p.label.clone(),
                        })
                        .collect(),
                    timestamp: m.timestamp,
                })
                .collect();
            *self.messages.lock().expect("messages lock poisoned") = converted.clone();
            *self
                .message_total_lines
                .lock()
                .expect("message total lines lock poisoned") = None;
            converted
        } else {
            self.messages
                .lock()
                .expect("messages lock poisoned")
                .clone()
        };
        let (total_lines, offset, follow_bottom, max_top_line) = if state.page == "logs" {
            let total_lines =
                crate::log_renderer::count_total_log_lines(&state.log_lines, content_w);
            let (offset, follow_bottom, max_top_line) = reconcile_scroll_state(
                &self.log_scroll_offset_lines,
                &self.log_follow_bottom,
                &self.log_max_scroll_y,
                total_lines,
                visible_height,
            );
            (total_lines, offset, follow_bottom, max_top_line)
        } else {
            let total_lines = {
                let mut cache = self
                    .message_total_lines
                    .lock()
                    .expect("message total lines lock poisoned");
                match *cache {
                    Some((cached_width, cached_total))
                        if !messages_updated && cached_width == content_w =>
                    {
                        cached_total
                    }
                    _ => {
                        let total = crate::message_renderer::count_total_message_lines(
                            &rust_messages,
                            content_w,
                        );
                        *cache = Some((content_w, total));
                        total
                    }
                }
            };
            let (offset, follow_bottom, max_top_line) = reconcile_scroll_state(
                &self.message_scroll_offset_lines,
                &self.message_follow_bottom,
                &self.message_max_scroll_y,
                total_lines,
                visible_height,
            );
            (total_lines, offset, follow_bottom, max_top_line)
        };
        let dragging = *self
            .dragging_scrollbar
            .lock()
            .expect("dragging lock poisoned");

        state.scroll.offset_lines = offset;
        state.scroll.sticky_bottom = follow_bottom;
        state.scroll.max_scroll_y = max_top_line;
        state.scroll.content_lines = total_lines;
        state.scroll.dragging_scrollbar = dragging;

        // --- 调用 Renderer ---
        let rust_state = crate::types::TuiState {
            page: state.page.clone(),
            log_lines: state.log_lines.clone(),
            messages: rust_messages,
            input: crate::types::TuiInputState {
                parts: parse_input_parts(state.input.parts),
                cursor_grapheme: state.input.cursor_grapheme,
                mode: state.input.mode.clone(),
            },
            sidebar: crate::types::TuiSidebarState {
                session_id: state.sidebar.session_id.clone(),
                cwd: state.sidebar.cwd.clone(),
                model: state.sidebar.model.clone(),
                agent: state.sidebar.agent.clone(),
                mode: state.sidebar.mode.clone(),
                context_used: state.sidebar.context_used,
                context_max: state.sidebar.context_max,
                cost_usd_this: state.sidebar.cost_usd_this,
                cost_usd_today: state.sidebar.cost_usd_today,
                today_messages: state.sidebar.today_messages,
                lsp_lines: state.sidebar.lsp_lines.clone(),
                docker_lines: state.sidebar.docker_lines.clone(),
                docker_url: state.sidebar.docker_url.clone(),
            },
            status: crate::types::TuiStatusState {
                thinking: state.status.thinking,
                text: state.status.text.clone(),
            },
            scroll: crate::types::TuiScrollState {
                offset_lines: state.scroll.offset_lines,
                max_scroll_y: state.scroll.max_scroll_y,
                content_lines: state.scroll.content_lines,
                sticky_bottom: state.scroll.sticky_bottom,
                dragging_scrollbar: state.scroll.dragging_scrollbar,
            },
            layout: crate::types::TuiLayout {
                header: to_layout_rect_internal(layout.header),
                messages: to_layout_rect_internal(layout.messages),
                messages_scrollbar: layout.messages_scrollbar.map(to_layout_rect_internal),
                input: to_layout_rect_internal(layout.input),
                footer: to_layout_rect_internal(layout.footer),
                sidebar: to_layout_rect_internal(layout.sidebar),
                has_sidebar: layout.has_sidebar,
                overlay: layout.overlay.map(to_layout_rect_internal),
            },
            overlay: state.overlay.map(|o| crate::types::TuiOverlayState {
                kind: o.kind,
                items: o.items,
                selected_index: o.selected_index,
                scroll_offset: o.scroll_offset,
                max_width: o.max_width,
            }),
            tick: state.tick,
            blink: state.blink,
        };

        self.inner.render_frame(&rust_state);
    }

    #[napi(js_name = "snapshotFrameLines")]
    pub fn snapshot_frame_lines(&self) -> Vec<String> {
        self.inner.snapshot_frame_lines()
    }

    #[napi(js_name = "snapshotFrameStyledLines")]
    pub fn snapshot_frame_styled_lines(&self) -> Vec<String> {
        self.inner.snapshot_frame_styled_lines()
    }

    #[napi(js_name = "handleMouse")]
    pub fn handle_mouse(&self, seq: String, input_lines: u16) -> bool {
        let event = if let Some(e) = crate::mouse::parse_sgr_mouse(&seq) {
            e
        } else {
            return false;
        };
        self.handle_mouse_event_internal(event, input_lines)
    }

    #[napi(js_name = "handleMouseEvent")]
    pub fn handle_mouse_event(&self, event: MouseEvent, input_lines: u16) -> bool {
        self.handle_mouse_event_internal(js_mouse_event_to_internal(event), input_lines)
    }

    #[napi(js_name = "messageScrollBy")]
    pub fn message_scroll_by(&self, delta: i32) {
        apply_scroll_delta(
            &self.message_scroll_offset_lines,
            &self.message_follow_bottom,
            &self.message_max_scroll_y,
            delta,
        );
    }

    #[napi(js_name = "messageScrollPageUp")]
    pub fn message_scroll_page_up(&self, page_size: u32) {
        self.message_scroll_by(-(page_size as i32));
    }

    #[napi(js_name = "messageScrollPageDown")]
    pub fn message_scroll_page_down(&self, page_size: u32) {
        self.message_scroll_by(page_size as i32);
    }

    #[napi(js_name = "messageScrollHome")]
    pub fn message_scroll_home(&self) {
        move_scroll_home(
            &self.message_scroll_offset_lines,
            &self.message_follow_bottom,
        );
    }

    #[napi(js_name = "messageScrollToBottom")]
    pub fn message_scroll_to_bottom(&self) {
        move_scroll_to_bottom(&self.message_follow_bottom);
    }

    #[napi(js_name = "messageScrollOffsetLines")]
    pub fn message_scroll_offset_lines(&self) -> u32 {
        *self
            .message_scroll_offset_lines
            .lock()
            .expect("message scroll lock poisoned")
    }

    #[napi(js_name = "messageScrollStickyBottom")]
    pub fn message_scroll_sticky_bottom(&self) -> bool {
        *self
            .message_follow_bottom
            .lock()
            .expect("message follow lock poisoned")
    }

    #[napi(js_name = "messageScrollSetTopLine")]
    pub fn message_scroll_set_top_line(&self, top_line: u32) {
        set_scroll_top_line(
            &self.message_scroll_offset_lines,
            &self.message_follow_bottom,
            &self.message_max_scroll_y,
            top_line,
        );
    }

    #[napi(js_name = "messageScrollSetFromScrollbar")]
    pub fn message_scroll_set_from_scrollbar(
        &self,
        line_count: u32,
        height: u32,
        pointer_row: i32,
        drag_offset: i32,
    ) {
        let top_line = crate::viewport::resolve_top_line_from_scrollbar(
            line_count,
            height,
            pointer_row,
            drag_offset,
        );
        self.message_scroll_set_top_line(top_line);
    }

    #[napi(js_name = "messageScrollJumpTo")]
    pub fn message_scroll_jump_to(
        &self,
        line_count: u32,
        height: u32,
        target_line: u32,
        anchor_numerator: u32,
        anchor_denominator: u32,
    ) {
        let top_line = crate::viewport::resolve_top_line_for_jump(
            line_count,
            height,
            target_line,
            anchor_numerator,
            anchor_denominator,
        );
        self.message_scroll_set_top_line(top_line);
    }

    #[napi(js_name = "logScrollRefresh")]
    pub fn log_scroll_refresh(
        &self,
        log_lines: Vec<String>,
        content_width: u32,
        viewport_height: u32,
    ) {
        let total_lines =
            crate::log_renderer::count_total_log_lines(&log_lines, content_width.max(1) as usize);
        let _ = reconcile_scroll_state(
            &self.log_scroll_offset_lines,
            &self.log_follow_bottom,
            &self.log_max_scroll_y,
            total_lines,
            viewport_height.max(1),
        );
    }

    #[napi(js_name = "logScrollBy")]
    pub fn log_scroll_by(&self, delta: i32) {
        apply_scroll_delta(
            &self.log_scroll_offset_lines,
            &self.log_follow_bottom,
            &self.log_max_scroll_y,
            delta,
        );
    }

    #[napi(js_name = "logScrollPageUp")]
    pub fn log_scroll_page_up(&self, page_size: u32) {
        self.log_scroll_by(-(page_size as i32));
    }

    #[napi(js_name = "logScrollPageDown")]
    pub fn log_scroll_page_down(&self, page_size: u32) {
        self.log_scroll_by(page_size as i32);
    }

    #[napi(js_name = "logScrollHome")]
    pub fn log_scroll_home(&self) {
        move_scroll_home(&self.log_scroll_offset_lines, &self.log_follow_bottom);
    }

    #[napi(js_name = "logScrollToBottom")]
    pub fn log_scroll_to_bottom(&self) {
        move_scroll_to_bottom(&self.log_follow_bottom);
    }

    #[napi(js_name = "logScrollOffsetLines")]
    pub fn log_scroll_offset_lines(&self) -> u32 {
        *self
            .log_scroll_offset_lines
            .lock()
            .expect("log scroll lock poisoned")
    }

    #[napi(js_name = "logScrollStickyBottom")]
    pub fn log_scroll_sticky_bottom(&self) -> bool {
        *self
            .log_follow_bottom
            .lock()
            .expect("log follow lock poisoned")
    }

    #[napi(js_name = "logScrollSetTopLine")]
    pub fn log_scroll_set_top_line(&self, top_line: u32) {
        set_scroll_top_line(
            &self.log_scroll_offset_lines,
            &self.log_follow_bottom,
            &self.log_max_scroll_y,
            top_line,
        );
    }

    #[napi(js_name = "logScrollSetFromScrollbar")]
    pub fn log_scroll_set_from_scrollbar(
        &self,
        line_count: u32,
        height: u32,
        pointer_row: i32,
        drag_offset: i32,
    ) {
        let top_line = crate::viewport::resolve_top_line_from_scrollbar(
            line_count,
            height,
            pointer_row,
            drag_offset,
        );
        self.log_scroll_set_top_line(top_line);
    }
}

#[napi]
pub fn ping() -> String {
    "pong from Rust".to_string()
}

#[napi(js_name = "computeTuiLayout")]
pub fn compute_tui_layout(
    cols: u16,
    rows: u16,
    input_lines: u16,
    overlay_item_count: Option<u16>,
    overlay_max_width: Option<u16>,
) -> TuiLayout {
    let layout = crate::layout::compute_layout(
        cols,
        rows,
        input_lines,
        overlay_item_count,
        overlay_max_width,
    );
    TuiLayout {
        header: to_layout_rect(layout.header),
        messages: to_layout_rect(layout.messages),
        messages_scrollbar: layout.messages_scrollbar.map(to_layout_rect),
        input: to_layout_rect(layout.input),
        footer: to_layout_rect(layout.footer),
        sidebar: to_layout_rect(layout.sidebar),
        has_sidebar: layout.has_sidebar,
        overlay: layout.overlay.map(to_layout_rect),
    }
}

#[napi(js_name = "wrapTextToWidth")]
pub fn wrap_text_to_width(text: String, max_width: u32) -> Vec<String> {
    crate::text_layout::wrap_text_to_width(&text, max_width as usize)
}

#[napi(js_name = "computeViewportVisibleRange")]
pub fn compute_viewport_visible_range(
    line_count: u32,
    top_line: u32,
    height: u32,
) -> ViewportRange {
    let range = crate::viewport::compute_visible_range(line_count, top_line, height);
    ViewportRange {
        start_line: range.start_line,
        end_line: range.end_line,
    }
}

#[napi(js_name = "computeScrollbarThumb")]
pub fn compute_scrollbar_thumb(
    content_height: u32,
    viewport_height: u32,
    scroll_top: u32,
    track_height: u32,
) -> ScrollbarThumb {
    let thumb = crate::viewport::compute_scrollbar_thumb(
        content_height,
        viewport_height,
        scroll_top,
        track_height,
    );
    ScrollbarThumb {
        visible: thumb.visible,
        thumb_top: thumb.thumb_top,
        thumb_height: thumb.thumb_height,
        track_height: thumb.track_height,
    }
}

#[napi(js_name = "resolveViewportTopLineFromScrollbar")]
pub fn resolve_viewport_top_line_from_scrollbar(
    line_count: u32,
    height: u32,
    pointer_row: i32,
    drag_offset: i32,
) -> u32 {
    crate::viewport::resolve_top_line_from_scrollbar(line_count, height, pointer_row, drag_offset)
}

#[napi(js_name = "resolveViewportTopLineForJump")]
pub fn resolve_viewport_top_line_for_jump(
    line_count: u32,
    height: u32,
    target_line: u32,
    anchor_numerator: u32,
    anchor_denominator: u32,
) -> u32 {
    crate::viewport::resolve_top_line_for_jump(
        line_count,
        height,
        target_line,
        anchor_numerator,
        anchor_denominator,
    )
}

#[napi(js_name = "buildEntryHeightCache")]
pub fn build_entry_height_cache(starts: Vec<u32>, ends: Vec<u32>) -> EntryHeightCache {
    let cache = crate::message_index::build_entry_height_cache(&starts, &ends);
    EntryHeightCache {
        heights: cache.heights,
        cum_heights: cache.cum_heights,
        total_lines: cache.total_lines,
    }
}

#[napi(js_name = "findEntryRangeIndex")]
pub fn find_entry_range_index(starts: Vec<u32>, ends: Vec<u32>, line: u32) -> i32 {
    crate::message_index::find_entry_range_index(&starts, &ends, line)
}

#[napi(js_name = "hitTest")]
pub fn hit_test(
    cols: u16,
    rows: u16,
    input_lines: u16,
    overlay_item_count: Option<u16>,
    overlay_max_width: Option<u16>,
    col: u16,
    row: u16,
) -> HitTargetResult {
    let layout = crate::layout::compute_layout(
        cols,
        rows,
        input_lines,
        overlay_item_count,
        overlay_max_width,
    );
    match crate::hit_test::hit_test(col, row, &layout) {
        crate::hit_test::HitTarget::DiffConfirm { rollback_point_id } => HitTargetResult {
            kind: "diff_confirm".to_string(),
            line_offset: None,
            row: None,
            ratio: None,
            index: None,
            id: Some(rollback_point_id),
        },
        crate::hit_test::HitTarget::DiffRevert { rollback_point_id } => HitTargetResult {
            kind: "diff_revert".to_string(),
            line_offset: None,
            row: None,
            ratio: None,
            index: None,
            id: Some(rollback_point_id),
        },
        crate::hit_test::HitTarget::WorkflowStep { id } => HitTargetResult {
            kind: "workflow_step".to_string(),
            line_offset: None,
            row: None,
            ratio: None,
            index: None,
            id: Some(id),
        },
        crate::hit_test::HitTarget::Overlay { row } => HitTargetResult {
            kind: "overlay".to_string(),
            line_offset: None,
            row: Some(row),
            ratio: None,
            index: None,
            id: None,
        },
        crate::hit_test::HitTarget::Message { line_offset } => HitTargetResult {
            kind: "message".to_string(),
            line_offset: Some(line_offset),
            row: None,
            ratio: None,
            index: None,
            id: None,
        },
        crate::hit_test::HitTarget::InputArea => HitTargetResult {
            kind: "input".to_string(),
            line_offset: None,
            row: None,
            ratio: None,
            index: None,
            id: None,
        },
        crate::hit_test::HitTarget::Sidebar { row } => HitTargetResult {
            kind: "sidebar".to_string(),
            line_offset: None,
            row: Some(row),
            ratio: None,
            index: None,
            id: None,
        },
        crate::hit_test::HitTarget::Scrollbar { ratio } => HitTargetResult {
            kind: "scrollbar".to_string(),
            line_offset: None,
            row: None,
            ratio: Some(ratio as f64),
            index: None,
            id: None,
        },
        crate::hit_test::HitTarget::Header => HitTargetResult {
            kind: "header".to_string(),
            line_offset: None,
            row: None,
            ratio: None,
            index: None,
            id: None,
        },
        crate::hit_test::HitTarget::Footer => HitTargetResult {
            kind: "footer".to_string(),
            line_offset: None,
            row: None,
            ratio: None,
            index: None,
            id: None,
        },
        crate::hit_test::HitTarget::None => HitTargetResult {
            kind: "none".to_string(),
            line_offset: None,
            row: None,
            ratio: None,
            index: None,
            id: None,
        },
    }
}

#[napi(js_name = "computeMessageHeights")]
pub fn compute_message_heights(messages: Vec<String>, content_width: u16) -> MessageHeightsResult {
    let heights = crate::message_renderer::compute_message_heights(&messages, content_width);
    MessageHeightsResult {
        heights: heights.heights,
        cum_heights: heights.cum_heights,
        total_lines: heights.total_lines,
    }
}

#[napi(js_name = "findVisibleMessageRange")]
pub fn find_visible_message_range(
    cum_heights: Vec<u32>,
    heights: Vec<u32>,
    scroll_offset: u32,
    viewport_height: u16,
) -> VisibleMessageRangeResult {
    let range = crate::message_renderer::find_visible_message_range(
        &cum_heights,
        &heights,
        scroll_offset,
        viewport_height,
    );
    VisibleMessageRangeResult {
        start_index: range.start_index,
        start_line_offset: range.start_line_offset as u16,
        end_index: range.end_index,
    }
}

#[napi(js_name = "renderInputParts")]
pub fn render_input_parts(
    parts: Vec<InputPartSpec>,
    cursor_grapheme: u32,
    max_width: u16,
    mode: String,
    placeholder: String,
) -> InputLayoutResult {
    let parsed = parse_input_parts(parts);
    let rendered = crate::input_renderer::render_input_parts(
        &parsed,
        cursor_grapheme,
        max_width,
        &mode,
        &placeholder,
    );
    let styled_lines = rendered
        .styled_lines
        .into_iter()
        .map(|line| InputStyledLine {
            segments: line
                .segments
                .into_iter()
                .map(|segment| InputStyledSegment {
                    text: segment.text,
                    tone: segment.tone,
                })
                .collect(),
        })
        .collect();
    InputLayoutResult {
        lines: rendered.lines,
        styled_lines,
        cursor_line: rendered.cursor_line,
        cursor_col: rendered.cursor_col,
        border_tone: rendered.border_tone,
        border_glyph: rendered.border_glyph,
        mode_chip_text: rendered.mode_chip_text,
        mode_chip_tone: rendered.mode_chip_tone,
        prompt_first: rendered.prompt_first,
        prompt_continuation: rendered.prompt_continuation,
        content_offset_first: rendered.content_offset_first,
        content_offset_continuation: rendered.content_offset_continuation,
        corner_tl: rendered.corner_tl,
        corner_tr: rendered.corner_tr,
        corner_bl: rendered.corner_bl,
        corner_br: rendered.corner_br,
        side_glyph: rendered.side_glyph,
        is_placeholder: rendered.is_placeholder,
    }
}

#[napi(js_name = "isFoldedDiffMarker")]
pub fn is_folded_diff_marker(line: String) -> bool {
    crate::semantics::is_folded_diff_marker(&line)
}

#[napi(js_name = "foldedMarkerHiddenCount")]
pub fn folded_marker_hidden_count(line: String) -> u32 {
    crate::semantics::folded_marker_hidden_count(&line)
}

#[napi(js_name = "isContextReadTool")]
pub fn is_context_read_tool(tool_name: String) -> bool {
    crate::semantics::is_context_read_tool(&tool_name)
}

#[napi(js_name = "contextGroupLabel")]
pub fn context_group_label(reads: u32) -> String {
    crate::semantics::context_group_label(reads)
}

#[napi(js_name = "inertialScrollDeltas")]
pub fn inertial_scroll_deltas(delta: i32, steps: u8) -> Vec<i32> {
    crate::inertia::inertial_scroll_deltas(delta, steps)
}

// --- Internal Helpers ---

fn parse_input_parts(parts: Vec<InputPartSpec>) -> Vec<crate::input_renderer::InputPart> {
    let mut out = Vec::new();
    for part in parts {
        let kind = part.kind.trim().to_ascii_lowercase();
        if kind == "file_pill" {
            if let Some(display) = part.display {
                out.push(crate::input_renderer::InputPart::FilePill { display });
            }
            continue;
        }
        if kind == "agent_pill" {
            if let Some(display) = part.display {
                out.push(crate::input_renderer::InputPart::AgentPill {
                    display,
                    agent_id: part.agent_id.unwrap_or_default(),
                });
            }
            continue;
        }
        if kind == "pasted_pill" {
            out.push(crate::input_renderer::InputPart::PastedPill {
                word_count: part.word_count.unwrap_or(0),
            });
            continue;
        }
        if kind == "image_pill" {
            out.push(crate::input_renderer::InputPart::ImagePill {
                index: part.index.unwrap_or(1),
            });
            continue;
        }
        out.push(crate::input_renderer::InputPart::Text(
            part.content.unwrap_or_default(),
        ));
    }
    out
}

fn to_layout_rect(rect: crate::layout::Rect) -> LayoutRect {
    LayoutRect {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
    }
}

fn to_layout_rect_internal(rect: crate::layout::Rect) -> crate::types::LayoutRect {
    crate::types::LayoutRect {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
    }
}

fn parse_hex_color(s: &str) -> Option<TermColor> {
    let trimmed = s.trim().trim_start_matches('#');
    if trimmed.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&trimmed[0..2], 16).ok()?;
    let g = u8::from_str_radix(&trimmed[2..4], 16).ok()?;
    let b = u8::from_str_radix(&trimmed[4..6], 16).ok()?;
    Some(TermColor::Rgb(r, g, b))
}

fn js_style_to_rust(js: &CellStyle) -> RustCellStyle {
    RustCellStyle {
        fg: js
            .fg
            .as_deref()
            .and_then(parse_hex_color)
            .unwrap_or(TermColor::Default),
        bg: js
            .bg
            .as_deref()
            .and_then(parse_hex_color)
            .unwrap_or(TermColor::Default),
        bold: js.bold.unwrap_or(false),
        dim: js.dim.unwrap_or(false),
        italic: js.italic.unwrap_or(false),
        underline: js.underline.unwrap_or(false),
        strikethrough: js.strikethrough.unwrap_or(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_contract_fixture() -> (Vec<u32>, Vec<u32>, u32) {
        let entry_heights = [3u32, 4, 2, 5, 3];
        let mut starts = Vec::with_capacity(entry_heights.len());
        let mut ends = Vec::with_capacity(entry_heights.len());
        let mut line = 0u32;
        for height in entry_heights {
            starts.push(line);
            ends.push(line + height - 1);
            line += height;
        }
        (starts, ends, line)
    }

    fn hit_signature(result: HitTargetResult) -> (String, Option<u16>, Option<u16>) {
        (result.kind, result.line_offset, result.row)
    }

    #[test]
    fn binding_entry_index_matches_core_search_for_contract_fixture() {
        let (starts, ends, total_lines) = build_contract_fixture();

        for line in 0..total_lines {
            assert_eq!(
                find_entry_range_index(starts.clone(), ends.clone(), line),
                crate::message_index::find_entry_range_index(&starts, &ends, line)
            );
        }

        assert_eq!(
            find_entry_range_index(starts.clone(), ends.clone(), total_lines + 10),
            -1
        );
    }

    #[test]
    fn binding_jump_and_scrollbar_resolvers_match_core_algorithms() {
        let (_, _, total_lines) = build_contract_fixture();
        let viewport_height = 6;
        let targets = [0u32, 4, 8, total_lines - 1];

        for target in targets {
            assert_eq!(
                resolve_viewport_top_line_for_jump(total_lines, viewport_height, target, 1, 3),
                crate::viewport::resolve_top_line_for_jump(total_lines, viewport_height, target, 1, 3)
            );
        }

        let line_count = 120u32;
        let height = 20u32;
        let scroll_offsets = [0u32, 7, 42, 88, 100];
        for scroll_offset in scroll_offsets {
            let thumb = compute_scrollbar_thumb(line_count, height, scroll_offset, height);
            assert!(thumb.visible);

            let pointer_row = (thumb.thumb_top + (thumb.thumb_height / 2)) as i32;
            assert_eq!(
                resolve_viewport_top_line_from_scrollbar(line_count, height, pointer_row, 0),
                crate::viewport::resolve_top_line_from_scrollbar(line_count, height, pointer_row, 0)
            );
        }
    }

    #[test]
    fn binding_hit_test_matches_core_layout_routing() {
        let layout = crate::layout::compute_layout(140, 30, 2, None, None);
        let binding_layout = compute_tui_layout(140, 30, 2, None, None);
        let scrollbar = layout.messages_scrollbar.expect("scrollbar rect");

        assert_eq!(binding_layout.messages.x, layout.messages.x);
        assert_eq!(binding_layout.messages.y, layout.messages.y);
        assert_eq!(
            binding_layout
                .messages_scrollbar
                .expect("binding scrollbar")
                .height,
            scrollbar.height
        );

        let points = [
            (layout.messages.x + 2, layout.messages.y + 2),
            (scrollbar.x, scrollbar.y + 1),
            (layout.input.x + 1, layout.input.y + 1),
            (layout.header.x + 1, layout.header.y),
            (layout.footer.x + 1, layout.footer.y),
            (layout.sidebar.x + 1, layout.sidebar.y + 1),
        ];

        for (col, row) in points {
            let binding = hit_signature(hit_test(140, 30, 2, None, None, col, row));
            let core = match crate::hit_test::hit_test(col, row, &layout) {
                crate::hit_test::HitTarget::Message { line_offset } => {
                    ("message".to_string(), Some(line_offset), None)
                }
                crate::hit_test::HitTarget::Scrollbar { .. } => {
                    ("scrollbar".to_string(), None, None)
                }
                crate::hit_test::HitTarget::InputArea => ("input".to_string(), None, None),
                crate::hit_test::HitTarget::Header => ("header".to_string(), None, None),
                crate::hit_test::HitTarget::Footer => ("footer".to_string(), None, None),
                crate::hit_test::HitTarget::Sidebar { row } => {
                    ("sidebar".to_string(), None, Some(row))
                }
                crate::hit_test::HitTarget::Overlay { row } => {
                    ("overlay".to_string(), None, Some(row))
                }
                crate::hit_test::HitTarget::DiffConfirm { .. } => {
                    ("diff_confirm".to_string(), None, None)
                }
                crate::hit_test::HitTarget::DiffRevert { .. } => {
                    ("diff_revert".to_string(), None, None)
                }
                crate::hit_test::HitTarget::WorkflowStep { .. } => {
                    ("workflow_step".to_string(), None, None)
                }
                crate::hit_test::HitTarget::None => ("none".to_string(), None, None),
            };

            assert_eq!(binding, core);
        }
    }
}
