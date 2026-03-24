use crate::buffer::{Buffer, Cell, CellStyle};
use crate::colors::{BG_PRIMARY, FG_FAINT, FG_GHOST};
use crate::layout::Rect;
use crate::types::TuiState;

fn dot_glyph(i: u32, active: u32) -> char {
    if i < active {
        '●'
    } else {
        '○'
    }
}

pub fn render_footer(buf: &mut Buffer, rect: Rect, state: &TuiState) {
    if rect.width == 0 || rect.height < 2 {
        return;
    }

    let bg = CellStyle {
        fg: FG_GHOST,
        bg: BG_PRIMARY,
        ..Default::default()
    };
    for x in rect.x..rect.x + rect.width {
        buf.set(
            x,
            rect.y,
            Cell {
                ch: ' ',
                style: bg,
                width: 1,
            },
        );
        buf.set(
            x,
            rect.y + 1,
            Cell {
                ch: ' ',
                style: bg,
                width: 1,
            },
        );
    }

    // 第一行：loading dots + 状态
    let mut dots = String::new();
    let active = (state.tick % 8).saturating_add(1);
    for i in 0..8u32 {
        dots.push(dot_glyph(i, active));
        if i != 7 {
            dots.push(' ');
        }
    }
    let left = if state.status.thinking {
        format!("{}  thinking", dots)
    } else if state.status.text.trim().is_empty() {
        "".to_string()
    } else {
        state.status.text.clone()
    };
    let left_style = CellStyle {
        fg: FG_FAINT,
        bg: BG_PRIMARY,
        ..Default::default()
    };
    buf.write_string(rect.x + 1, rect.y, &left, left_style, Some(rect));

    // 第一行右侧：快捷键提示
    let right = "esc interrupt    ctrl+k commands";
    let right_style = CellStyle {
        fg: FG_GHOST,
        bg: BG_PRIMARY,
        ..Default::default()
    };
    let right_w = crate::unicode::string_display_width(right) as u16;
    let right_x = rect
        .x
        .saturating_add(rect.width)
        .saturating_sub(right_w)
        .saturating_sub(1);
    buf.write_string(right_x, rect.y, right, right_style, Some(rect));

    // 第二行：模式 + ctx + 成本（Week4 再接入人民币）
    let mode = state.sidebar.mode.to_uppercase();
    let ctx_used = state.sidebar.context_used;
    let ctx_max = state.sidebar.context_max.max(1);
    let cost_this = state.sidebar.cost_usd_this;
    let cost_today = state.sidebar.cost_usd_today;
    let line2 = format!(
        "{}  ·  ctx {}/{}  ·  ${:.2} 本次  ·  ${:.2} 今日",
        mode, ctx_used, ctx_max, cost_this, cost_today
    );
    buf.write_string(rect.x + 1, rect.y + 1, &line2, right_style, Some(rect));

    // Debug scroll state
    let debug_text = format!(
        "Y:{} / MAX:{} . STICKY:{}",
        state.scroll.offset_lines,
        state.scroll.max_scroll_y,
        if state.scroll.sticky_bottom {
            "ON"
        } else {
            "OFF"
        }
    );
    buf.write_string(
        rect.x + rect.width.saturating_sub(debug_text.len() as u16 + 2),
        rect.y + 1,
        &debug_text,
        CellStyle {
            fg: crate::colors::FG_BRAND,
            bg: crate::colors::BG_PRIMARY,
            ..Default::default()
        },
        Some(rect),
    );
}
