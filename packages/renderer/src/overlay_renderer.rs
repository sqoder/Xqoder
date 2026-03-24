use crate::buffer::{Buffer, Cell, CellStyle, TermColor};
use crate::colors::{BG_TOOL, FG_BRAND, FG_MUTED, FG_PRIMARY};
use crate::layout::Rect;
use crate::types::TuiState;

pub fn render_overlay(buf: &mut Buffer, rect: Rect, state: &TuiState) {
    if let Some(overlay) = &state.overlay {
        // 1. 绘制阴影/边框背景 (BG_SECONDARY: #13131A)
        let bg_style = CellStyle {
            fg: FG_PRIMARY,
            bg: BG_TOOL,
            ..Default::default()
        };

        for r in 0..rect.height {
            for c in 0..rect.width {
                buf.set(
                    rect.x + c,
                    rect.y + r,
                    Cell {
                        ch: ' ',
                        style: bg_style,
                        width: 1,
                    },
                );
            }
        }

        // 2. 绘制标题
        if overlay.kind == "complete" {
            let title_style = CellStyle {
                fg: FG_MUTED,
                bg: BG_TOOL,
                bold: true,
                ..Default::default()
            };
            buf.write_string(
                rect.x + 2,
                rect.y + 1,
                "Reference Completion",
                title_style,
                Some(rect),
            );
        } else if overlay.kind == "commands" {
            let title_style = CellStyle {
                fg: FG_MUTED,
                bg: BG_TOOL,
                bold: true,
                ..Default::default()
            };
            buf.write_string(
                rect.x + 2,
                rect.y + 1,
                "Command Palette",
                title_style,
                Some(rect),
            );
        }

        // 3. 绘制列表项
        let list_start_y = rect.y + 2;
        let visible_items = overlay
            .items
            .iter()
            .skip(overlay.scroll_offset as usize)
            .take(rect.height.saturating_sub(3) as usize);

        for (i, item) in visible_items.enumerate() {
            let row = list_start_y + i as u16;
            if row >= rect.y + rect.height - 1 {
                break;
            }

            let is_selected =
                (overlay.scroll_offset as usize + i) == overlay.selected_index as usize;
            let item_style = if is_selected {
                CellStyle {
                    fg: TermColor::Rgb(255, 255, 255),
                    bg: FG_BRAND,
                    bold: true,
                    ..Default::default()
                }
            } else {
                CellStyle {
                    fg: FG_PRIMARY,
                    bg: BG_TOOL,
                    ..Default::default()
                }
            };

            // 绘制背景行
            if is_selected {
                for c in 0..rect.width.saturating_sub(2) {
                    buf.set(
                        rect.x + 1 + c,
                        row,
                        Cell {
                            ch: ' ',
                            style: item_style,
                            width: 1,
                        },
                    );
                }
            }

            buf.write_string(rect.x + 2, row, item, item_style, Some(rect));
        }
    }
}
