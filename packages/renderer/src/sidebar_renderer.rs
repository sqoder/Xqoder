use crate::buffer::{Buffer, Cell, CellStyle};
use crate::colors::{BG_PRIMARY, BG_TOOL, FG_BRAND, FG_FAINT, FG_GHOST, FG_MUTED, FG_PRIMARY};
use crate::layout::Rect;
use crate::types::TuiState;

fn shorten_id(id: &str) -> String {
    let s = id.trim();
    if s.len() <= 14 {
        return s.to_string();
    }
    let head = &s[0..6.min(s.len())];
    let tail = &s[s.len().saturating_sub(6)..];
    format!("{head}…{tail}")
}

fn truncate_path_middle(p: &str, max: usize) -> String {
    let s = p.trim();
    if s.len() <= max {
        return s.to_string();
    }
    let head = &s[0..max.saturating_sub(9).max(4)];
    let tail = &s[s.len().saturating_sub(4)..];
    format!("{head}…{tail}")
}

fn fill_rect(buf: &mut Buffer, rect: Rect, style: CellStyle) {
    for y in rect.y..rect.y.saturating_add(rect.height) {
        for x in rect.x..rect.x.saturating_add(rect.width) {
            buf.set(
                x,
                y,
                Cell {
                    ch: ' ',
                    style,
                    width: 1,
                },
            );
        }
    }
}

fn write_line(buf: &mut Buffer, rect: Rect, row: u16, text: &str, style: CellStyle) {
    if row >= rect.height {
        return;
    }
    buf.write_string(rect.x + 1, rect.y + row, text, style, Some(rect));
}

pub fn render_sidebar(buf: &mut Buffer, rect: Rect, state: &TuiState) {
    if rect.width == 0 || rect.height == 0 {
        return;
    }

    fill_rect(
        buf,
        rect,
        CellStyle {
            fg: FG_PRIMARY,
            bg: BG_PRIMARY,
            ..Default::default()
        },
    );

    let heading = CellStyle {
        fg: FG_FAINT,
        bg: BG_PRIMARY,
        bold: true,
        ..Default::default()
    };
    let value = CellStyle {
        fg: FG_MUTED,
        bg: BG_PRIMARY,
        ..Default::default()
    };
    let muted = CellStyle {
        fg: FG_GHOST,
        bg: BG_PRIMARY,
        ..Default::default()
    };

    let mut row: u16 = 0;

    write_line(buf, rect, row, "Context", heading);
    row += 1;
    let cwd_line = if state.sidebar.cwd.trim().is_empty() {
        "(no cwd)".to_string()
    } else {
        truncate_path_middle(&state.sidebar.cwd, 28)
    };
    write_line(buf, rect, row, cwd_line.as_str(), muted);
    row += 1;
    write_line(
        buf,
        rect,
        row,
        format!("Model: {}", state.sidebar.model).as_str(),
        value,
    );
    row += 1;
    write_line(
        buf,
        rect,
        row,
        format!("Agent: {}", state.sidebar.agent).as_str(),
        value,
    );
    row += 2;

    write_line(buf, rect, row, "Session", heading);
    row += 1;
    write_line(
        buf,
        rect,
        row,
        format!("ID: {}", shorten_id(&state.sidebar.session_id)).as_str(),
        muted,
    );
    row += 1;
    write_line(
        buf,
        rect,
        row,
        format!("Mode: {}", state.sidebar.mode).as_str(),
        value,
    );
    row += 2;

    // Cost（Week4：显示本次 + 今日，单位 USD）
    write_line(buf, rect, row, "Cost", heading);
    row += 1;
    write_line(
        buf,
        rect,
        row,
        format!("This: ${:.2}", state.sidebar.cost_usd_this).as_str(),
        CellStyle {
            fg: FG_BRAND,
            bg: BG_PRIMARY,
            ..Default::default()
        },
    );
    row += 1;
    write_line(
        buf,
        rect,
        row,
        format!("Today: ${:.2}", state.sidebar.cost_usd_today).as_str(),
        value,
    );
    row += 1;
    write_line(
        buf,
        rect,
        row,
        format!("Msgs: {}", state.sidebar.today_messages).as_str(),
        value,
    );
    row += 2;

    // LSP（Week4：显示配置/状态行）
    if row + 2 < rect.height {
        write_line(buf, rect, row, "LSP", heading);
        row += 1;
        for line in state.sidebar.lsp_lines.iter().take(3) {
            if row >= rect.height {
                break;
            }
            write_line(buf, rect, row, line.as_str(), value);
            row += 1;
        }
        row += 1;
    }

    // Docker 沙盒状态（Week5）
    if row + 2 < rect.height {
        write_line(buf, rect, row, "Docker Sandbox", heading);
        row += 1;

        if state.sidebar.docker_lines.is_empty() {
            write_line(
                buf,
                rect,
                row,
                "(not started yet)",
                CellStyle {
                    fg: FG_GHOST,
                    bg: BG_PRIMARY,
                    ..Default::default()
                },
            );
        } else {
            for line in state.sidebar.docker_lines.iter().take(3) {
                if row >= rect.height {
                    break;
                }
                write_line(buf, rect, row, line.as_str(), value);
                row += 1;
            }

            if !state.sidebar.docker_url.trim().is_empty() && row + 1 <= rect.height {
                write_line(
                    buf,
                    rect,
                    row,
                    "[在浏览器打开]",
                    CellStyle {
                        fg: FG_MUTED,
                        bg: BG_PRIMARY,
                        bold: true,
                        ..Default::default()
                    },
                );
            }
        }
    }

    // 分隔块底色点缀（小条）
    if rect.height >= 1 {
        let chip = CellStyle {
            fg: FG_PRIMARY,
            bg: BG_TOOL,
            ..Default::default()
        };
        for x in rect.x..rect.x.saturating_add(rect.width) {
            buf.set(
                x,
                rect.y,
                Cell {
                    ch: ' ',
                    style: chip,
                    width: 1,
                },
            );
        }
    }
}
