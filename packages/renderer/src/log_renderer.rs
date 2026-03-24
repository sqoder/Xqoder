use crate::buffer::{Buffer, Cell, CellStyle};
use crate::colors::{BG_PRIMARY, BG_TOOL, FG_BRAND, FG_GHOST, FG_PRIMARY};
use crate::layout::Rect;
use crate::text_layout::wrap_text_to_width;
use crate::types::TuiState;

fn content_width(rect: Rect) -> usize {
    rect.width.saturating_sub(2) as usize
}

pub fn count_total_log_lines(lines: &[String], max_width: usize) -> u32 {
    let width = max_width.max(1);
    lines.iter().fold(0u32, |total, line| {
        let wrapped = wrap_text_to_width(line, width);
        total.saturating_add(wrapped.len().max(1) as u32)
    })
}

pub fn render_logs(buf: &mut Buffer, rect: Rect, state: &TuiState) {
    if rect.width == 0 || rect.height == 0 {
        return;
    }

    let bg = CellStyle {
        fg: FG_PRIMARY,
        bg: BG_PRIMARY,
        ..Default::default()
    };
    for y in rect.y..rect.y + rect.height {
        for x in rect.x..rect.x + rect.width {
            buf.set(
                x,
                y,
                Cell {
                    ch: ' ',
                    style: bg,
                    width: 1,
                },
            );
        }
    }

    let text_rect = rect;
    let width = content_width(text_rect).max(1);
    let visible_height = text_rect.height.max(1) as u32;
    let total_lines = count_total_log_lines(&state.log_lines, width);
    let max_top_line = total_lines.saturating_sub(visible_height);
    let top_line = if state.scroll.sticky_bottom {
        max_top_line
    } else {
        state.scroll.offset_lines.min(max_top_line)
    };
    let visible = crate::viewport::compute_visible_range(total_lines, top_line, visible_height);
    let mut global_line: u32 = 0;
    let mut y = text_rect.y;

    for line in &state.log_lines {
        let wrapped = wrap_text_to_width(line, width);
        for visual_line in wrapped.iter().take(std::cmp::max(1, wrapped.len())) {
            if global_line >= visible.start_line
                && global_line < visible.end_line
                && y < text_rect.y + text_rect.height
            {
                buf.write_string(
                    text_rect.x + 1,
                    y,
                    visual_line,
                    CellStyle {
                        fg: FG_PRIMARY,
                        bg: BG_PRIMARY,
                        ..Default::default()
                    },
                    Some(text_rect),
                );
                y = y.saturating_add(1);
            }
            global_line = global_line.saturating_add(1);
            if y >= text_rect.y + text_rect.height && global_line >= visible.end_line {
                break;
            }
        }
        if y >= text_rect.y + text_rect.height && global_line >= visible.end_line {
            break;
        }
    }

    if let Some(sb_rect) = state.layout.messages_scrollbar {
        let sb_rect = crate::layout::Rect::new(sb_rect.x, sb_rect.y, sb_rect.width, sb_rect.height);
        let viewport_h = sb_rect.height as u32;
        let thumb = crate::viewport::compute_scrollbar_thumb(
            total_lines,
            visible_height,
            top_line,
            viewport_h,
        );

        let track_style = CellStyle {
            fg: FG_GHOST,
            bg: BG_TOOL,
            ..Default::default()
        };
        for y_sb in sb_rect.y..sb_rect.y + sb_rect.height {
            buf.set(
                sb_rect.x,
                y_sb,
                Cell {
                    ch: ' ',
                    style: track_style,
                    width: 1,
                },
            );
        }

        if thumb.visible {
            let thumb_style = CellStyle {
                fg: FG_BRAND,
                bg: FG_BRAND,
                ..Default::default()
            };
            let thumb_y0 = sb_rect.y.saturating_add(thumb.thumb_top as u16);
            let thumb_y1 = (thumb_y0 + thumb.thumb_height as u16).min(sb_rect.y + sb_rect.height);
            for y_thumb in thumb_y0..thumb_y1 {
                buf.set(
                    sb_rect.x,
                    y_thumb,
                    Cell {
                        ch: ' ',
                        style: thumb_style,
                        width: 1,
                    },
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::count_total_log_lines;

    #[test]
    fn wraps_long_logs_into_visual_lines() {
        let lines = vec!["abcdef".to_string(), "xy".to_string()];
        assert_eq!(count_total_log_lines(&lines, 3), 3);
    }
}
