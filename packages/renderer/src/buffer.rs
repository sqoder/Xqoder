use std::io::{self, Write};

use crossterm::cursor::MoveTo;
use crossterm::style::Color;
use crossterm::terminal;
use crossterm::QueueableCommand;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TermColor {
    Rgb(u8, u8, u8),
    Default,
}

impl From<Color> for TermColor {
    fn from(value: Color) -> Self {
        match value {
            Color::Rgb { r, g, b } => TermColor::Rgb(r, g, b),
            _ => TermColor::Default,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CellStyle {
    pub fg: TermColor,
    pub bg: TermColor,
    pub bold: bool,
    pub dim: bool,
    pub italic: bool,
    pub underline: bool,
    pub strikethrough: bool,
}

impl Default for CellStyle {
    fn default() -> Self {
        Self {
            fg: TermColor::Default,
            bg: TermColor::Default,
            bold: false,
            dim: false,
            italic: false,
            underline: false,
            strikethrough: false,
        }
    }
}

#[derive(Clone, PartialEq, Debug)]
pub struct Cell {
    pub ch: char,
    pub style: CellStyle,
    pub width: u8,
}

impl Default for Cell {
    fn default() -> Self {
        Self {
            ch: ' ',
            style: CellStyle::default(),
            width: 1,
        }
    }
}

pub struct Buffer {
    pub cols: u16,
    pub rows: u16,
    pub cells: Vec<Cell>,
    terminal_cursor: Option<(u16, u16)>,
}

impl Buffer {
    pub fn new(cols: u16, rows: u16) -> Self {
        Self {
            cols,
            rows,
            cells: vec![Cell::default(); (cols * rows) as usize],
            terminal_cursor: None,
        }
    }

    pub fn get(&self, col: u16, row: u16) -> &Cell {
        &self.cells[(row * self.cols + col) as usize]
    }

    pub fn set(&mut self, col: u16, row: u16, cell: Cell) {
        if col < self.cols && row < self.rows {
            self.cells[(row * self.cols + col) as usize] = cell;
        }
    }

    pub fn write_string(
        &mut self,
        col: u16,
        row: u16,
        s: &str,
        style: CellStyle,
        clip: Option<crate::layout::Rect>,
    ) {
        let mut x = col;
        for c in s.chars() {
            if x >= self.cols {
                break;
            }
            if let Some(rect) = clip {
                if !rect.contains(x, row) {
                    x += crate::unicode::char_display_width(c) as u16;
                    continue;
                }
            }
            let w = crate::unicode::char_display_width(c);
            self.set(
                x,
                row,
                Cell {
                    ch: c,
                    style,
                    width: w,
                },
            );
            // 宽字符会占用 2 列：第二列必须标记为占位，否则 diff_flush 会把它当作
            // “需要写一个空格”的独立单元，造成 CJK 被强行插空格。
            if w > 1 && x + 1 < self.cols {
                self.set(
                    x + 1,
                    row,
                    Cell {
                        ch: ' ',
                        style,
                        width: 0,
                    },
                );
            }
            x += w as u16;
        }
    }

    pub fn clear(&mut self) {
        self.cells.iter_mut().for_each(|c| *c = Cell::default());
    }

    pub fn snapshot_plain_lines(&self) -> Vec<String> {
        let mut lines = Vec::with_capacity(self.rows as usize);
        for row in 0..self.rows {
            let mut line = String::with_capacity(self.cols as usize);
            for col in 0..self.cols {
                let cell = self.get(col, row);
                // 宽字符的占位单元，不应重复输出。
                if cell.width == 0 {
                    continue;
                }
                line.push(cell.ch);
            }
            while line.ends_with(' ') {
                line.pop();
            }
            lines.push(line);
        }
        lines
    }

    pub fn snapshot_styled_lines(&self) -> Vec<String> {
        let mut lines = Vec::with_capacity(self.rows as usize);
        for row in 0..self.rows {
            let mut visible_cells: Vec<&Cell> = Vec::with_capacity(self.cols as usize);
            for col in 0..self.cols {
                let cell = self.get(col, row);
                // 宽字符占位单元不输出，避免重复。
                if cell.width == 0 {
                    continue;
                }
                visible_cells.push(cell);
            }

            while let Some(last) = visible_cells.last() {
                if last.ch == ' ' {
                    visible_cells.pop();
                } else {
                    break;
                }
            }

            if visible_cells.is_empty() {
                lines.push(String::new());
                continue;
            }

            let mut line = String::new();
            let mut run_style = visible_cells[0].style;
            let mut run_text = String::new();
            for cell in visible_cells {
                if cell.style != run_style {
                    append_snapshot_style_run(&mut line, run_style, &run_text);
                    run_style = cell.style;
                    run_text.clear();
                }
                run_text.push(cell.ch);
            }
            append_snapshot_style_run(&mut line, run_style, &run_text);
            lines.push(line);
        }
        lines
    }

    pub fn set_terminal_cursor(&mut self, col: u16, row: u16) {
        self.terminal_cursor = Some((col, row));
    }

    pub fn clear_terminal_cursor(&mut self) {
        self.terminal_cursor = None;
    }

    pub fn fill(&mut self, cell: Cell) {
        self.cells.iter_mut().for_each(|c| *c = cell.clone());
    }

    pub fn diff_flush<W: Write>(&self, other: &mut Buffer, out: &mut W) -> io::Result<()> {
        out.write_all(b"\x1b[?25l")?;
        // 关键：关闭自动换行（DECAWM），避免写到右下角触发终端滚屏（表现为界面“上飘”）
        // 渲染结束后会恢复。
        out.write_all(b"\x1b[?7l")?;

        let mut last_style = CellStyle::default();
        let mut last_row = u16::MAX;
        let mut last_col = u16::MAX;

        // 重要：以“真实终端尺寸”为上限进行 flush，避免 row/col 越界触发终端滚屏。
        // 当 IME/候选条出现时，终端 rows 可能会短暂变小。
        let (term_cols, term_rows) = terminal::size().unwrap_or((self.cols, self.rows));
        let max_rows = self.rows.min(other.rows).min(term_rows);
        let max_cols = self.cols.min(other.cols).min(term_cols);

        for row in 0..max_rows {
            for col in 0..max_cols {
                // 右下角（最后一行最后一列）在很多终端上即使写空格也可能触发换行/滚屏，
                // 这里直接跳过输出，但仍保持 current 同步，避免每帧反复 diff。
                if row + 1 == max_rows && col + 1 == max_cols {
                    let next = self.get(col, row);
                    let curr = other.get(col, row);
                    if next.width == 0 {
                        if next != curr {
                            other.set(col, row, next.clone());
                        }
                    } else if next != curr {
                        other.set(col, row, next.clone());
                    }
                    continue;
                }
                let next = self.get(col, row);
                let curr = other.get(col, row);

                // 宽字符占位格：不输出，但要同步 current，避免每帧都被判定为 diff。
                if next.width == 0 {
                    if next != curr {
                        other.set(col, row, next.clone());
                    }
                    continue;
                }

                if next == curr {
                    continue;
                }

                let is_consecutive = row == last_row && col == last_col + 1;
                if !is_consecutive {
                    out.queue(MoveTo(col, row))?;
                }

                let style_changed = last_style != next.style;
                if style_changed {
                    write_style(out, &next.style, &last_style)?;
                    last_style = next.style;
                }

                write!(out, "{}", next.ch)?;
                last_row = row;
                last_col = col.saturating_add(next.width.saturating_sub(1) as u16);

                other.set(col, row, next.clone());
            }
        }

        out.write_all(b"\x1b[39m\x1b[49m\x1b[22m\x1b[23m\x1b[24m\x1b[29m")?;

        // 将“真实终端 cursor”移动到我们渲染的输入光标位置。
        // 这一步对 IME/候选框定位至关重要，否则候选会跟着终端最后一次写入的位置跑偏。
        if let Some((cur_col, cur_row)) = self.terminal_cursor {
            if cur_col < max_cols && cur_row < max_rows {
                out.queue(MoveTo(cur_col, cur_row))?;
            }
        }

        // 恢复自动换行（DECAWM）
        out.write_all(b"\x1b[?7h")?;
        out.write_all(b"\x1b[?25h")?;
        out.flush()?;
        Ok(())
    }
}

fn write_style<W: Write>(out: &mut W, curr: &CellStyle, prev: &CellStyle) -> io::Result<()> {
    if curr.fg != prev.fg {
        match curr.fg {
            TermColor::Rgb(r, g, b) => write!(out, "\x1b[38;2;{};{};{}m", r, g, b)?,
            TermColor::Default => out.write_all(b"\x1b[39m")?,
        }
    }

    if curr.bg != prev.bg {
        match curr.bg {
            TermColor::Rgb(r, g, b) => write!(out, "\x1b[48;2;{};{};{}m", r, g, b)?,
            TermColor::Default => out.write_all(b"\x1b[49m")?,
        }
    }

    let curr_intensity = curr.bold || curr.dim;
    let prev_intensity = prev.bold || prev.dim;
    if curr_intensity != prev_intensity {
        if curr_intensity {
            if curr.bold {
                out.write_all(b"\x1b[1m")?;
            } else {
                out.write_all(b"\x1b[2m")?;
            }
        } else {
            out.write_all(b"\x1b[22m")?;
        }
    } else if curr_intensity && prev_intensity && curr.bold != prev.bold {
        if curr.bold {
            out.write_all(b"\x1b[1m")?;
        } else {
            out.write_all(b"\x1b[2m")?;
        }
    }

    if curr.italic != prev.italic {
        if curr.italic {
            out.write_all(b"\x1b[3m")?;
        } else {
            out.write_all(b"\x1b[23m")?;
        }
    }

    if curr.underline != prev.underline {
        if curr.underline {
            out.write_all(b"\x1b[4m")?;
        } else {
            out.write_all(b"\x1b[24m")?;
        }
    }

    if curr.strikethrough != prev.strikethrough {
        if curr.strikethrough {
            out.write_all(b"\x1b[9m")?;
        } else {
            out.write_all(b"\x1b[29m")?;
        }
    }

    Ok(())
}

fn append_snapshot_style_run(out: &mut String, style: CellStyle, text: &str) {
    out.push('[');
    out.push_str(&snapshot_style(style));
    out.push(']');
    out.push_str(&format!("{text:?}"));
}

fn snapshot_style(style: CellStyle) -> String {
    format!(
        "fg={},bg={},b={},d={},i={},u={},s={}",
        snapshot_color(style.fg),
        snapshot_color(style.bg),
        bool_digit(style.bold),
        bool_digit(style.dim),
        bool_digit(style.italic),
        bool_digit(style.underline),
        bool_digit(style.strikethrough),
    )
}

fn snapshot_color(color: TermColor) -> String {
    match color {
        TermColor::Rgb(r, g, b) => format!("#{r:02x}{g:02x}{b:02x}"),
        TermColor::Default => "default".to_string(),
    }
}

fn bool_digit(value: bool) -> char {
    if value {
        '1'
    } else {
        '0'
    }
}

#[cfg(test)]
mod tests {
    use super::{Buffer, Cell, CellStyle, TermColor};

    #[test]
    fn diff_flush_syncs_current_and_skips_unchanged_cells() {
        let mut next = Buffer::new(10, 5);
        let mut curr = Buffer::new(10, 5);
        next.set(
            0,
            0,
            Cell {
                ch: 'A',
                ..Cell::default()
            },
        );

        let mut out = Vec::new();
        next.diff_flush(&mut curr, &mut out)
            .expect("diff_flush should succeed");
        let first = String::from_utf8(out).expect("first diff output should be utf8");
        assert!(first.contains('A'));

        let mut out2 = Vec::new();
        next.diff_flush(&mut curr, &mut out2)
            .expect("second diff_flush should succeed");
        let second = String::from_utf8(out2).expect("second diff output should be utf8");
        assert!(!second.contains('A'));
        assert!(!second.contains("\x1b[1;1H"));
    }

    #[test]
    fn diff_flush_emits_49m_on_background_reset_transition() {
        let mut next = Buffer::new(4, 1);
        let mut curr = Buffer::new(4, 1);

        let painted = CellStyle {
            bg: TermColor::Rgb(19, 19, 26),
            ..CellStyle::default()
        };

        next.set(
            0,
            0,
            Cell {
                ch: 'A',
                style: painted,
                width: 1,
            },
        );
        next.set(
            1,
            0,
            Cell {
                ch: 'B',
                style: CellStyle::default(),
                width: 1,
            },
        );

        let mut out = Vec::new();
        next.diff_flush(&mut curr, &mut out)
            .expect("diff_flush should succeed");
        let ansi = String::from_utf8(out).expect("diff output should be utf8");

        assert!(ansi.contains("\x1b[48;2;19;19;26m"));
        assert!(ansi.contains("\x1b[49m"));
    }

    #[test]
    fn snapshot_plain_lines_skips_wide_char_placeholder_cells() {
        let mut buf = Buffer::new(4, 1);
        let style = CellStyle::default();
        buf.write_string(0, 0, "你A", style, None);
        let lines = buf.snapshot_plain_lines();
        assert_eq!(lines, vec!["你A".to_string()]);
    }

    #[test]
    fn snapshot_styled_lines_captures_style_runs_and_wide_char_cells() {
        let mut buf = Buffer::new(4, 1);
        let red = CellStyle {
            fg: TermColor::Rgb(255, 0, 0),
            ..CellStyle::default()
        };
        let blue_bold = CellStyle {
            fg: TermColor::Rgb(0, 0, 255),
            bold: true,
            ..CellStyle::default()
        };

        buf.set(
            0,
            0,
            Cell {
                ch: '你',
                style: red,
                width: 2,
            },
        );
        buf.set(
            1,
            0,
            Cell {
                ch: ' ',
                style: red,
                width: 0,
            },
        );
        buf.set(
            2,
            0,
            Cell {
                ch: 'A',
                style: blue_bold,
                width: 1,
            },
        );

        let lines = buf.snapshot_styled_lines();
        assert_eq!(
            lines,
            vec![
                "[fg=#ff0000,bg=default,b=0,d=0,i=0,u=0,s=0]\"你\"[fg=#0000ff,bg=default,b=1,d=0,i=0,u=0,s=0]\"A\""
                    .to_string()
            ]
        );
    }
}
