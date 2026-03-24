#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}

impl Rect {
    pub fn new(x: u16, y: u16, width: u16, height: u16) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    pub fn contains(&self, col: u16, row: u16) -> bool {
        col >= self.x
            && col < self.x.saturating_add(self.width)
            && row >= self.y
            && row < self.y.saturating_add(self.height)
    }

    pub fn abs(&self, rel_col: u16, rel_row: u16) -> (u16, u16) {
        (
            self.x.saturating_add(rel_col),
            self.y.saturating_add(rel_row),
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Layout {
    pub header: Rect,
    pub messages: Rect,
    pub messages_scrollbar: Option<Rect>,
    pub input: Rect,
    pub footer: Rect,
    pub sidebar: Rect,
    pub has_sidebar: bool,
    pub overlay: Option<Rect>,
}

pub fn compute_layout(
    cols: u16,
    rows: u16,
    input_lines: u16,
    overlay_item_count: Option<u16>,
    overlay_max_width: Option<u16>,
) -> Layout {
    let sidebar_w = if cols > 120 { 32 } else { 0 };
    let has_sidebar = sidebar_w > 0;
    let content_w = cols.saturating_sub(sidebar_w);

    let header_h = 1u16;
    let footer_h = 2u16;
    // 输入组件几何（用于 Codex “panel + 右/下偏移阴影”）：
    // - layout.input 表示“真正面板主体 panel”（不含右/下偏移阴影那 1 行/1 列的外溢空间）
    // - 预留的 right/bottom shadow 空间通过输入区总高度 input_total_h 来保证不会被 footer 覆盖
    let input_total_h = (input_lines.saturating_add(2)).clamp(3, 8);
    let panel_h = input_total_h.saturating_sub(1).max(1);
    // 预留 right shadow 1 列：panel_rect 不占最后一列，shadow_rect 将占用这一列
    let panel_w = content_w.saturating_sub(1).max(1);
    let available_messages_h = rows
        .saturating_sub(header_h)
        .saturating_sub(input_total_h)
        .saturating_sub(footer_h);
    let messages_h = available_messages_h.max(1);

    let header_y = 0;
    let messages_y = header_h;
    let input_y = header_h.saturating_add(messages_h);
    let footer_y = input_y.saturating_add(input_total_h);

    let mut overlay = None;
    if let Some(total_items) = overlay_item_count {
        let max_list_rows = 7u16;
        let list_rows = total_items.min(max_list_rows);
        let box_h = 3 + list_rows + 1;
        let content_w_val = overlay_max_width.unwrap_or(40).clamp(24, 58);

        let box_w = (content_w.saturating_sub(2)).min(content_w_val + 4);
        let box_x = (content_w.saturating_sub(box_w)).min(2).max(1);
        let box_y = (rows.saturating_sub(box_h)).saturating_sub(4).max(1);

        overlay = Some(Rect::new(box_x, box_y, box_w, box_h));
    }

    let mut messages_rect = Rect::new(0, messages_y, content_w, messages_h);
    let mut messages_scrollbar = None;

    if content_w >= 4 {
        let sb_w = 1u16;
        let main_w = content_w.saturating_sub(sb_w);
        messages_rect.width = main_w;
        messages_scrollbar = Some(Rect::new(main_w, messages_y, sb_w, messages_h));
    }

    Layout {
        header: Rect::new(0, header_y, content_w, header_h),
        messages: messages_rect,
        messages_scrollbar,
        // layout.input 仅包含 panel 主体
        input: Rect::new(0, input_y, panel_w, panel_h),
        footer: Rect::new(0, footer_y, content_w, footer_h),
        sidebar: Rect::new(content_w, 0, sidebar_w, rows),
        has_sidebar,
        overlay,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compute_layout_without_sidebar() {
        let layout = compute_layout(80, 24, 1, None, None);
        assert!(!layout.has_sidebar);
        assert_eq!(layout.sidebar.width, 0);
        assert_eq!(layout.header.height, 1);
        assert_eq!(layout.input.height, 2);
        assert_eq!(layout.messages.height, 18);
        assert_eq!(layout.footer.y, 22);
        assert_eq!(layout.footer.height, 2);
        assert_eq!(layout.messages.width, 79);
        assert_eq!(
            layout.messages_scrollbar,
            Some(Rect::new(79, layout.messages.y, 1, layout.messages.height))
        );
    }

    #[test]
    fn compute_layout_with_sidebar() {
        let layout = compute_layout(140, 30, 1, None, None);
        assert!(layout.has_sidebar);
        assert_eq!(layout.sidebar.width, 32);
        assert_eq!(layout.sidebar.x, 108);
        assert_eq!(layout.messages.width, 107);
        assert_eq!(
            layout.messages_scrollbar,
            Some(Rect::new(107, layout.messages.y, 1, layout.messages.height))
        );
    }

    #[test]
    fn rect_contains_works() {
        let rect = Rect::new(10, 5, 20, 10);
        assert!(rect.contains(10, 5));
        assert!(rect.contains(29, 14));
        assert!(!rect.contains(30, 5));
        assert!(!rect.contains(10, 15));
    }
}
