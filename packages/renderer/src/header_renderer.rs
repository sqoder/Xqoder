use crate::buffer::{Buffer, Cell, CellStyle};
use crate::colors::{BG_PRIMARY, BG_TOOL, FG_BRAND, FG_FAINT, FG_GHOST, FG_MUTED, FG_PRIMARY};
use crate::layout::Rect;
use crate::types::TuiState;

fn truncate_middle(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    if max <= 1 {
        return "…".to_string();
    }
    let keep_front = (max - 1) / 2;
    let keep_back = max - 1 - keep_front;
    format!("{}…{}", &s[..keep_front], &s[s.len() - keep_back..])
}

pub fn render_header(buf: &mut Buffer, rect: Rect, state: &TuiState) {
    if rect.width == 0 || rect.height == 0 {
        return;
    }

    let bg = CellStyle {
        fg: FG_PRIMARY,
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
    }

    // 左侧：X qoder · session
    let x0 = rect.x.saturating_add(1);
    let brand_x = CellStyle {
        fg: FG_BRAND,
        bg: BG_PRIMARY,
        bold: true,
        ..Default::default()
    };
    buf.write_string(x0, rect.y, "X", brand_x, Some(rect));

    let title_style = CellStyle {
        fg: FG_PRIMARY,
        bg: BG_PRIMARY,
        bold: true,
        ..Default::default()
    };
    buf.write_string(x0 + 1, rect.y, "qoder", title_style, Some(rect));

    let sep_style = CellStyle {
        fg: FG_GHOST,
        bg: BG_PRIMARY,
        ..Default::default()
    };
    buf.write_string(x0 + 6, rect.y, " · ", sep_style, Some(rect));

    let session = truncate_middle(&state.sidebar.session_id, 18);
    let session_style = CellStyle {
        fg: FG_FAINT,
        bg: BG_PRIMARY,
        ..Default::default()
    };
    buf.write_string(x0 + 9, rect.y, &session, session_style, Some(rect));

    // 右侧：model tag（用工具块背景模拟 chip）
    let model_text = format!(" {} ", state.sidebar.model);
    let model_style = CellStyle {
        fg: FG_MUTED,
        bg: BG_TOOL,
        ..Default::default()
    };
    let w = crate::unicode::string_display_width(&model_text) as u16;
    let model_x = rect
        .x
        .saturating_add(rect.width)
        .saturating_sub(w)
        .saturating_sub(1);
    buf.write_string(model_x, rect.y, &model_text, model_style, Some(rect));
}
