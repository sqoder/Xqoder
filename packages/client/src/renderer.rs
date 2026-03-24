use crossterm::style::Color;
use xqoder_renderer::buffer::CellStyle;
use xqoder_renderer::renderer::Renderer as CoreRenderer;

use crate::protocol::CellUpdate;

pub struct FrameRenderer {
    cols: u16,
    rows: u16,
    inner: CoreRenderer,
}

impl FrameRenderer {
    pub fn new(cols: u16, rows: u16) -> Self {
        Self {
            cols,
            rows,
            inner: CoreRenderer::new(cols, rows, 60),
        }
    }

    pub fn render_frame(&mut self, cells: &[CellUpdate]) {
        let mut required_cols = self.cols;
        let mut required_rows = self.rows;

        for cell in cells {
            required_cols = required_cols.max(cell.col.saturating_add(1));
            required_rows = required_rows.max(cell.row.saturating_add(1));
        }

        if required_cols != self.cols || required_rows != self.rows {
            self.cols = required_cols;
            self.rows = required_rows;
            self.inner.resize(required_cols, required_rows);
            self.inner.clear();
        }

        for cell in cells {
            let ch = cell.ch.chars().next().unwrap_or(' ');
            let style = CellStyle {
                fg: cell.fg.as_deref().and_then(parse_hex_color),
                bg: cell.bg.as_deref().and_then(parse_hex_color),
                bold: cell.bold.unwrap_or(false),
                dim: cell.dim.unwrap_or(false),
                italic: cell.italic.unwrap_or(false),
                underline: cell.underline.unwrap_or(false),
                strikethrough: false,
            };

            let text = ch.to_string();
            self.inner.write_text(cell.col, cell.row, &text, style);
        }

        self.inner.invalidate();
    }
}

fn parse_hex_color(value: &str) -> Option<Color> {
    let trimmed = value.trim().trim_start_matches('#');
    if trimmed.len() != 6 {
        return None;
    }

    let r = u8::from_str_radix(&trimmed[0..2], 16).ok()?;
    let g = u8::from_str_radix(&trimmed[2..4], 16).ok()?;
    let b = u8::from_str_radix(&trimmed[4..6], 16).ok()?;
    Some(Color::Rgb { r, g, b })
}
