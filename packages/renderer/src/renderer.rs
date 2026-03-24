use std::io::{sink, stdout, BufWriter, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::buffer::{Buffer, Cell, CellStyle};
use crate::colors::BG_PRIMARY;
use crate::unicode::char_display_width;
use crossterm::terminal;

pub struct Renderer {
    /// 用户写入的"下一帧"buffer（通过 write_text / clear 操作）
    pub next: Arc<Mutex<Buffer>>,
    /// 当前屏幕状态（diff 后同步）
    pub current: Arc<Mutex<Buffer>>,
    /// 是否有待刷新的内容（dirty flag）
    dirty: Arc<Mutex<bool>>,
    /// 渲染线程 handle
    _thread: thread::JoinHandle<()>,
}

impl Renderer {
    /// 创建并启动 60 FPS 渲染循环
    pub fn new(cols: u16, rows: u16, fps: u32) -> Self {
        let next = Arc::new(Mutex::new(Buffer::new(cols, rows)));
        let current = Arc::new(Mutex::new(Buffer::new(cols, rows)));
        let dirty = Arc::new(Mutex::new(false));

        let next_clone = Arc::clone(&next);
        let current_clone = Arc::clone(&current);
        let dirty_clone = Arc::clone(&dirty);
        let frame_duration = Duration::from_micros(1_000_000 / fps as u64);

        let handle = thread::spawn(move || {
            let mut out: Box<dyn Write + Send> = if renderer_output_is_suppressed() {
                Box::new(BufWriter::new(sink()))
            } else {
                Box::new(BufWriter::new(stdout()))
            };
            loop {
                let start = Instant::now();

                let is_dirty = {
                    let mut d = dirty_clone.lock().unwrap();
                    let value = *d;
                    *d = false;
                    value
                };

                if is_dirty {
                    let next_buf = next_clone.lock().unwrap();
                    let mut curr_buf = current_clone.lock().unwrap();
                    let _ = next_buf.diff_flush(&mut curr_buf, &mut out);
                }

                // 精确控制帧率
                let elapsed = start.elapsed();
                if elapsed < frame_duration {
                    thread::sleep(frame_duration - elapsed);
                }
            }
        });

        Self {
            next,
            current,
            dirty,
            _thread: handle,
        }
    }

    /// 在 next buffer 的 (col, row) 处写入文本（支持宽字符）
    pub fn write_text(&self, col: u16, row: u16, text: &str, style: CellStyle) {
        let mut buf = self.next.lock().unwrap();
        let mut c = col;
        for ch in text.chars() {
            if c >= buf.cols {
                break;
            }
            let w = char_display_width(ch);
            buf.set(
                c,
                row,
                Cell {
                    ch,
                    style: style.clone(),
                    width: w,
                },
            );
            if w > 1 && c + 1 < buf.cols {
                buf.set(
                    c + 1,
                    row,
                    Cell {
                        ch: ' ',
                        style: style.clone(),
                        width: 0,
                    },
                );
            }
            c += w as u16;
        }
    }

    /// 清空 next buffer 指定行
    pub fn clear_line(&self, row: u16) {
        let mut buf = self.next.lock().unwrap();
        for col in 0..buf.cols {
            buf.set(col, row, Cell::default());
        }
    }

    /// 清空整个 next buffer
    pub fn clear(&self) {
        self.next.lock().unwrap().clear();
    }

    /// 标记需要刷新（状态变化时调用）
    pub fn invalidate(&self) {
        *self.dirty.lock().unwrap() = true;
    }

    /// 调整终端尺寸
    pub fn resize(&self, cols: u16, rows: u16) {
        *self.next.lock().unwrap() = Buffer::new(cols, rows);
        *self.current.lock().unwrap() = Buffer::new(cols, rows);
    }

    /// 【核心】原子化提交并渲染整屏
    /// 使用纯 Rust 类型，实现与 NAPI 的解耦。
    pub fn render_frame(&self, state: &crate::types::TuiState) {
        // 重要：以“Rust 侧真实终端尺寸”为准
        let (real_cols_raw, real_rows_raw) = terminal::size().unwrap_or((0, 0));
        let real_cols = real_cols_raw;
        let real_rows = real_rows_raw.saturating_sub(1).max(1);

        if real_cols > 0 && real_rows > 0 {
            let mut next_guard = self.next.lock().unwrap();
            if next_guard.cols != real_cols || next_guard.rows != real_rows {
                *next_guard = Buffer::new(real_cols, real_rows);
                *self.current.lock().unwrap() = Buffer::new(real_cols, real_rows);
            }
        }

        let mut next = self.next.lock().unwrap();
        let cols = next.cols;
        let rows = next.rows;

        next.clear_terminal_cursor();
        crate::click_map::clear();

        next.fill(Cell {
            ch: ' ',
            style: CellStyle {
                fg: crate::buffer::TermColor::Default,
                bg: BG_PRIMARY,
                ..Default::default()
            },
            width: 1,
        });

        // 动态计算输入框行数（与 bindings.rs 保持一致）
        let mut input_lines = 1u16;
        for p in &state.input.parts {
            let part_lines = match p {
                crate::input_renderer::InputPart::Text(s) => s.lines().count() as u16,
                _ => 1,
            };
            input_lines = input_lines.max(part_lines);
        }
        let input_lines = input_lines.min(6).max(1) + 1;

        let overlay_item_count = state.overlay.as_ref().map(|o| o.items.len() as u16);
        let overlay_max_width = state.overlay.as_ref().and_then(|o| o.max_width);

        let layout = crate::layout::compute_layout(
            cols,
            rows,
            input_lines,
            overlay_item_count,
            overlay_max_width,
        );

        crate::header_renderer::render_header(&mut next, layout.header, state);
        if state.page == "logs" {
            crate::log_renderer::render_logs(&mut next, layout.messages, state);
        } else {
            crate::message_renderer::render_messages(&mut next, layout.messages, state);
        }
        crate::input_renderer::render_input(&mut next, layout.input, state);
        crate::footer_renderer::render_footer(&mut next, layout.footer, state);
        if layout.has_sidebar {
            crate::sidebar_renderer::render_sidebar(&mut next, layout.sidebar, state);
        }

        if let Some(overlay_rect) = layout.overlay {
            crate::overlay_renderer::render_overlay(&mut next, overlay_rect, state);
        }

        *self.dirty.lock().unwrap() = true;
    }

    pub fn snapshot_frame_lines(&self) -> Vec<String> {
        self.next
            .lock()
            .unwrap()
            .snapshot_plain_lines()
    }

    pub fn snapshot_frame_styled_lines(&self) -> Vec<String> {
        self.next
            .lock()
            .unwrap()
            .snapshot_styled_lines()
    }
}

fn renderer_output_is_suppressed() -> bool {
    matches!(
        std::env::var("XQODER_RENDERER_SINK_OUTPUT"),
        Ok(value) if matches!(value.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on")
    )
}
