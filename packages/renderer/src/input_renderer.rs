use crate::buffer::{Buffer, Cell, CellStyle, TermColor};
use crate::colors::{FG_BRAND, FG_FAINT, FG_GHOST, FG_PRIMARY, PILL_FILE_BG};
use crate::layout::Rect;
use crate::text_layout::wrap_text_to_width;
use crate::types::{InputLayoutResult, InputStyledLine, InputStyledSegment, TuiState};
use crate::unicode::string_display_width;

pub enum InputPart {
    Text(String),
    FilePill { display: String },
    AgentPill { display: String, agent_id: String },
    PastedPill { word_count: u32 },
    ImagePill { index: u32 },
}

fn input_parts_to_plain(parts: &[crate::input_renderer::InputPart]) -> String {
    let mut out = String::new();
    for p in parts {
        let piece = match p {
            InputPart::Text(s) => s.clone(),
            InputPart::FilePill { display } => display.clone(),
            InputPart::AgentPill { display, .. } => display.clone(),
            InputPart::PastedPill { word_count } => format!("[paste {}w]", word_count),
            InputPart::ImagePill { index } => format!("[image {}]", index),
        };
        out.push_str(&piece);
    }
    out
}

fn render_input_with_shadow(buf: &mut Buffer, rect: Rect, state: &TuiState) {
    // rect 表示“真正输入主体 panel”（不含 right/bottom shadow 预留的外溢那 1 行/1 列空间）
    if rect.width < 5 || rect.height < 2 {
        return;
    }

    const BG_INPUT: TermColor = TermColor::Rgb(28, 28, 36);
    const BG_SHADOW: TermColor = TermColor::Rgb(8, 8, 10);
    // Codex-like purple accent
    const FG_ACCENT: TermColor = TermColor::Rgb(139, 92, 246);

    let panel_rect = rect;

    // Codex-like 偏移：
    // - right shadow 在 panel 外右侧 1 列，并且 y 从 panel.y+1 开始形成“投影感”
    // - bottom shadow 在 panel 外下侧 1 行，并且 x 从 panel.x+1 开始避免和 left accent 列重叠
    let right_shadow_rect = Rect::new(
        panel_rect.x + panel_rect.width,
        panel_rect.y + 1,
        1,
        panel_rect.height,
    );
    let bottom_shadow_rect = Rect::new(
        panel_rect.x + 1,
        panel_rect.y + panel_rect.height,
        panel_rect.width,
        1,
    );

    // 1) 先画 shadow 层
    let shadow_style = CellStyle {
        fg: FG_PRIMARY,
        bg: BG_SHADOW,
        ..Default::default()
    };
    for y in right_shadow_rect.y..right_shadow_rect.y.saturating_add(right_shadow_rect.height) {
        for x in right_shadow_rect.x..right_shadow_rect.x.saturating_add(right_shadow_rect.width) {
            buf.set(
                x,
                y,
                Cell {
                    ch: ' ',
                    style: shadow_style,
                    width: 1,
                },
            );
        }
    }
    for y in bottom_shadow_rect.y
        ..bottom_shadow_rect
            .y
            .saturating_add(bottom_shadow_rect.height)
    {
        for x in bottom_shadow_rect.x
            ..bottom_shadow_rect
                .x
                .saturating_add(bottom_shadow_rect.width)
        {
            buf.set(
                x,
                y,
                Cell {
                    ch: ' ',
                    style: shadow_style,
                    width: 1,
                },
            );
        }
    }

    // 2) 再画 panel 主体底色
    let panel_bg_style = CellStyle {
        fg: FG_PRIMARY,
        bg: BG_INPUT,
        ..Default::default()
    };
    for y in panel_rect.y..panel_rect.y.saturating_add(panel_rect.height) {
        for x in panel_rect.x..panel_rect.x.saturating_add(panel_rect.width) {
            buf.set(
                x,
                y,
                Cell {
                    ch: ' ',
                    style: panel_bg_style,
                    width: 1,
                },
            );
        }
    }

    // 3) accent（panel 内）
    let accent_x = panel_rect.x;
    let accent_y0 = panel_rect.y;
    let accent_y1 = panel_rect.y + panel_rect.height.saturating_sub(1);
    let accent_style = CellStyle {
        fg: FG_PRIMARY,
        bg: FG_ACCENT,
        ..Default::default()
    };
    for y in accent_y0..=accent_y1 {
        buf.set(
            accent_x,
            y,
            Cell {
                ch: ' ',
                style: accent_style,
                width: 1,
            },
        );
    }

    let is_shell = state.input.mode.eq_ignore_ascii_case("shell");
    let prompt = if is_shell { "!" } else { "›" };
    let prompt_style = CellStyle {
        fg: if is_shell { FG_BRAND } else { FG_FAINT },
        bg: BG_INPUT,
        ..Default::default()
    };

    let raw = input_parts_to_plain(&state.input.parts);
    let placeholder = "Type a message...";
    let content = if raw.trim().is_empty() {
        placeholder
    } else {
        raw.as_str()
    };
    let content_style = CellStyle {
        fg: if raw.trim().is_empty() {
            FG_GHOST
        } else {
            FG_PRIMARY
        },
        bg: BG_INPUT,
        ..Default::default()
    };

    // 每帧在绘制 prompt/text/cursor 之前，先把“内容区”整行清空。
    // 否则当本帧内容比上一帧短（例如输入从 placeholder 变成 “ni hao”），
    // 末尾字符可能残留在 terminal buffer 上，出现 “ni haoType a message...”。
    let content_x0 = panel_rect.x + 1;
    let content_x1_excl = panel_rect.x + panel_rect.width;
    let content_y0 = panel_rect.y + 1;
    let content_y1_excl = panel_rect.y + panel_rect.height;
    let clear_style = CellStyle {
        fg: FG_PRIMARY,
        bg: BG_INPUT,
        ..Default::default()
    };
    for y in content_y0..content_y1_excl {
        for x in content_x0..content_x1_excl {
            buf.set(
                x,
                y,
                Cell {
                    ch: ' ',
                    style: clear_style,
                    width: 1,
                },
            );
        }
    }

    // 内容从 panel_rect.y + 1 开始，最大落到 panel 最后一行。
    let inner_w = panel_rect.width.saturating_sub(3).max(1) as usize; // prompt + space + 文本
    let wrapped = wrap_text_to_width(content, inner_w);
    let max_lines = panel_rect.height.saturating_sub(1) as usize;
    let shown = wrapped.into_iter().take(max_lines);

    for (i, row_text) in shown.enumerate() {
        let y = panel_rect.y + 1 + i as u16;
        buf.write_string(panel_rect.x + 1, y, prompt, prompt_style, Some(panel_rect));
        buf.write_string(
            panel_rect.x + 3,
            y,
            &row_text,
            content_style,
            Some(panel_rect),
        );
    }

    // file pill（仅 panel 内）
    if raw.contains('@') && !raw.trim().is_empty() {
        if let Some(start) = raw.find('@') {
            let end = raw[start..]
                .find(char::is_whitespace)
                .map(|d| start + d)
                .unwrap_or(raw.len());
            let pill = &raw[start..end];
            let pill_style = CellStyle {
                fg: TermColor::Rgb(255, 255, 255),
                bg: PILL_FILE_BG,
                ..Default::default()
            };
            buf.write_string(
                panel_rect.x + 3 + start as u16,
                panel_rect.y + 1,
                pill,
                pill_style,
                Some(panel_rect),
            );
        }
    }

    // cursor（仅 panel 内）
    // 终端 cursor 必须与可视文本坐标同源，IME 才会跟着输入框走。
    // content_before_cursor 用“光标偏移”切分输入，随后用同一套 wrap 规则推导出 cursor 所在行列。
    let content_for_wrap = if raw.trim().is_empty() {
        ""
    } else {
        raw.as_str()
    };
    let cursor_index = state
        .input
        .cursor_grapheme
        .min(content_for_wrap.chars().count() as u32);
    let before = content_for_wrap
        .chars()
        .take(cursor_index as usize)
        .collect::<String>();
    let inner_w = panel_rect.width.saturating_sub(3).max(1) as usize;
    let before_lines = wrap_text_to_width(&before, inner_w);
    let cursor_line_idx = before_lines.len().saturating_sub(1) as u16;
    let empty = String::new();
    let last_line = before_lines.last().unwrap_or(&empty);
    let cursor_col_w = string_display_width(last_line) as u16;

    let content_origin_x = panel_rect.x + 3;
    let content_origin_y = panel_rect.y + 1;
    let max_cursor_y = panel_rect.y + panel_rect.height.saturating_sub(2);
    let cursor_y = content_origin_y
        .saturating_add(cursor_line_idx)
        .min(max_cursor_y);
    let max_cursor_x = panel_rect.x + panel_rect.width.saturating_sub(1);
    let cursor_x = content_origin_x
        .saturating_add(cursor_col_w)
        .min(max_cursor_x);

    buf.set_terminal_cursor(cursor_x, cursor_y);

    // 可视“方块光标”按同一坐标绘制（可选，仅用于视觉反馈）
    if state.blink {
        buf.set(
            cursor_x,
            cursor_y,
            Cell {
                ch: '█',
                style: CellStyle {
                    fg: FG_BRAND,
                    bg: BG_INPUT,
                    ..Default::default()
                },
                width: 1,
            },
        );
    }
}

pub fn render_input(buf: &mut Buffer, rect: Rect, state: &TuiState) {
    render_input_with_shadow(buf, rect, state);
}

pub fn render_input_parts(
    parts: &[InputPart],
    cursor_grapheme: u32,
    max_width: u16,
    mode: &str,
    placeholder: &str,
) -> InputLayoutResult {
    // 目前供 TS 侧做布局/调试用：返回纯文本行 + 最基础的 tone 标注
    let is_shell = mode.eq_ignore_ascii_case("shell");
    let prompt_first = if is_shell {
        "!".to_string()
    } else {
        "›".to_string()
    };
    let prompt_continuation = " ".to_string();

    let mut plain = String::new();
    for p in parts {
        match p {
            InputPart::Text(s) => plain.push_str(s),
            InputPart::FilePill { display } => {
                plain.push_str(display);
            }
            InputPart::AgentPill { display, .. } => {
                plain.push_str(display);
            }
            InputPart::PastedPill { word_count } => {
                plain.push_str(&format!("[paste {}w]", word_count));
            }
            InputPart::ImagePill { index } => {
                plain.push_str(&format!("[image {}]", index));
            }
        }
    }
    let is_placeholder = plain.trim().is_empty();
    let content = if is_placeholder { placeholder } else { &plain };
    let lines = wrap_text_to_width(content, max_width.max(1) as usize);

    InputLayoutResult {
        lines: lines.clone(),
        styled_lines: lines
            .into_iter()
            .map(|l| InputStyledLine {
                segments: vec![InputStyledSegment {
                    text: l,
                    tone: if is_placeholder { "ghost" } else { "primary" }.to_string(),
                }],
            })
            .collect(),
        cursor_line: 0,
        cursor_col: cursor_grapheme as u16,
        border_tone: if is_shell { "brand" } else { "ghost" }.to_string(),
        border_glyph: "─".to_string(),
        mode_chip_text: mode.to_uppercase(),
        mode_chip_tone: if is_shell { "brand" } else { "ghost" }.to_string(),
        prompt_first,
        prompt_continuation,
        content_offset_first: 2,
        content_offset_continuation: 2,
        corner_tl: "".to_string(),
        corner_tr: "".to_string(),
        corner_bl: "".to_string(),
        corner_br: "".to_string(),
        side_glyph: "".to_string(),
        is_placeholder,
    }
}
