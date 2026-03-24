use crate::buffer::{Buffer, Cell, CellStyle};
use crate::colors::{
    BADGE_DONE_BG, BADGE_DONE_FG, BADGE_ERR_BG, BADGE_ERR_FG, BADGE_RUN_BG, BADGE_RUN_FG,
    BG_PRIMARY, BG_TOOL, FG_BRAND, FG_FAINT, FG_GHOST, FG_MUTED, FG_PRIMARY, FG_SECONDARY,
};
use crate::layout::Rect;
use crate::text_layout::wrap_text_to_width;
use crate::types::TuiState;
use crate::unicode::string_display_width;

fn repeat(ch: char, count: u16) -> String {
    std::iter::repeat(ch).take(count as usize).collect()
}

fn content_width(rect: Rect) -> usize {
    rect.width.saturating_sub(2) as usize
}

fn truncate_to_width_end(text: &str, max_w: u16) -> String {
    if max_w == 0 {
        return String::new();
    }
    let mut out = String::new();
    let mut w: u16 = 0;
    for ch in text.chars() {
        let cw = crate::unicode::char_display_width(ch) as u16;
        if w.saturating_add(cw) > max_w {
            break;
        }
        out.push(ch);
        w = w.saturating_add(cw);
    }
    out
}

/// 计算消息区“全局行模型”的总行数（用于 viewport clamp / scroll）。
///
/// 必须与 `render_messages()` 中实际 emit_line 的顺序与次数严格一致，
/// 否则会出现“滚动单位不一致 -> 顶部空白/台阶/滚动错位”。
pub fn count_total_message_lines(messages: &[crate::types::Message], max_width: usize) -> u32 {
    let w = max_width.max(1);
    let mut total: u32 = 0;

    for msg in messages {
        // header 行：
        // - user/assistant：有 header（you/xqoder）
        // - system：有 header（System）
        // - tool：无 header
        if msg.role == "user" || msg.role == "assistant" || msg.role == "system" {
            total = total.saturating_add(1);
        }

        // parts 行：
        for part in &msg.parts {
            if part.kind == "text" {
                if let Some(content) = &part.content {
                    for raw in content.lines() {
                        total = total.saturating_add(wrap_text_to_width(raw, w).len() as u32);
                    }
                }
            } else if part.kind == "tool"
                || part.kind == "context_group"
                || part.kind == "thinking"
                || part.kind == "diff_actions"
                || part.kind == "workflow_progress"
            {
                // 这些分支在 render_messages() 里都是“各 emit_line 一次”
                total = total.saturating_add(1);
            }
        }

        // msg 尾部固定 emit 两次：
        // - 分隔线（─）
        // - 空行
        total = total.saturating_add(2);
    }

    total
}

fn write_badge_right(
    buf: &mut Buffer,
    rect: Rect,
    y: u16,
    text: &str,
    fg: crate::buffer::TermColor,
    bg: crate::buffer::TermColor,
) {
    let w = string_display_width(text) as u16;
    if w == 0 || rect.width == 0 {
        return;
    }
    let x = rect
        .x
        .saturating_add(rect.width)
        .saturating_sub(w)
        .saturating_sub(1);
    buf.write_string(
        x,
        y,
        text,
        CellStyle {
            fg,
            bg,
            ..Default::default()
        },
        Some(rect),
    );
}

pub fn render_messages(buf: &mut Buffer, rect: Rect, state: &TuiState) {
    if rect.width == 0 || rect.height == 0 {
        return;
    }

    // 先只保留“消息区背景 + 文本可视切片”的一致几何：
    // viewport 切片只影响文本渲染，不要改变消息区容器背景 rect。
    let text_rect = rect;

    // 背景填充（避免残留污染）
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

    // viewport 切片：先用“无限 content length”避免因行数估算不一致导致的底部空白。
    let w = content_width(text_rect).max(1);
    let visible_height = text_rect.height as u32;
    let visible_height = visible_height.max(1);

    let total_lines = if state.scroll.content_lines > 0 {
        state.scroll.content_lines
    } else {
        count_total_message_lines(&state.messages, w)
    };
    let max_top_line = total_lines.saturating_sub(visible_height);
    let top_line = if state.scroll.sticky_bottom {
        max_top_line
    } else {
        state.scroll.offset_lines.min(max_top_line)
    };
    let visible = crate::viewport::compute_visible_range(total_lines, top_line, visible_height);
    let mut global_line: u32 = 0;
    let mut y = text_rect.y;

    let emit_line = |buf: &mut Buffer,
                     rect: Rect,
                     visible: &crate::viewport::VisibleRange,
                     y: &mut u16,
                     global_line: &mut u32,
                     text: &str,
                     style: CellStyle| {
        if *global_line >= visible.start_line && *global_line < visible.end_line {
            if *y < rect.y + rect.height {
                buf.write_string(rect.x + 1, *y, text, style, Some(rect));
                *y = y.saturating_add(1);
            }
        }
        *global_line = global_line.saturating_add(1);
    };

    for msg in &state.messages {
        // transcript-blocks 规则：
        // - user/assistant 才有 header 行
        // - tool/system 不输出 header 行（只输出内容）
        if msg.role == "user" || msg.role == "assistant" {
            let (who, who_style) = if msg.role == "user" {
                (
                    "you",
                    CellStyle {
                        fg: FG_FAINT,
                        bg: BG_PRIMARY,
                        ..Default::default()
                    },
                )
            } else {
                (
                    "xqoder",
                    CellStyle {
                        fg: FG_BRAND,
                        bg: BG_PRIMARY,
                        ..Default::default()
                    },
                )
            };

            emit_line(
                buf,
                text_rect,
                &visible,
                &mut y,
                &mut global_line,
                who,
                who_style,
            );
        } else if msg.role == "system" {
            // system 在 transcript-blocks header 使用 'System'
            emit_line(
                buf,
                text_rect,
                &visible,
                &mut y,
                &mut global_line,
                "System",
                CellStyle {
                    fg: FG_FAINT,
                    bg: BG_PRIMARY,
                    ..Default::default()
                },
            );
        }

        for part in &msg.parts {
            if part.kind == "text" {
                if let Some(content) = &part.content {
                    for raw in content.lines() {
                        for wrapped in wrap_text_to_width(raw, w) {
                            emit_line(
                                buf,
                                text_rect,
                                &visible,
                                &mut y,
                                &mut global_line,
                                &wrapped,
                                CellStyle {
                                    fg: FG_PRIMARY,
                                    bg: BG_PRIMARY,
                                    ..Default::default()
                                },
                            );
                        }
                    }
                }
            } else if part.kind == "tool" {
                // Week2：先把工具块以统一底色渲染出来（折叠/动画 Week4/5 再细化）
                let title = format!(
                    "▏▸ {} {}",
                    part.tool_name.clone().unwrap_or_else(|| "tool".to_string()),
                    part.summary.clone().unwrap_or_default()
                )
                .trim_end()
                .to_string();
                emit_line(
                    buf,
                    text_rect,
                    &visible,
                    &mut y,
                    &mut global_line,
                    &title,
                    CellStyle {
                        fg: FG_MUTED,
                        bg: BG_TOOL,
                        ..Default::default()
                    },
                );
            } else if part.kind == "context_group" {
                // items: ["read ...", "grep ..."] -> 先简化为 label
                let label = "◈ gathered context";
                emit_line(
                    buf,
                    text_rect,
                    &visible,
                    &mut y,
                    &mut global_line,
                    label,
                    CellStyle {
                        fg: FG_SECONDARY,
                        bg: BG_PRIMARY,
                        ..Default::default()
                    },
                );
            } else if part.kind == "thinking" {
                emit_line(
                    buf,
                    text_rect,
                    &visible,
                    &mut y,
                    &mut global_line,
                    "…",
                    CellStyle {
                        fg: FG_GHOST,
                        bg: BG_PRIMARY,
                        ..Default::default()
                    },
                );
            } else if part.kind == "diff_actions" {
                // 交互式 diff 按钮（点击区域注册给 hit_test）
                let rollback_id = part
                    .action_id
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string());
                let keep = "[✓ 保留]";
                let revert = "[✗ 撤销]";
                let line = format!("{keep}  {revert}");

                // 渲染按钮行
                emit_line(
                    buf,
                    text_rect,
                    &visible,
                    &mut y,
                    &mut global_line,
                    &line,
                    CellStyle {
                        fg: FG_PRIMARY,
                        bg: BG_PRIMARY,
                        ..Default::default()
                    },
                );

                // 如果这一行在 viewport 内，注册点击区域
                // 注意：emit_line 内部可能不会真正写入（因为虚拟滚动），所以这里只能用“最后写入行”的 y-1
                let rendered_y = y.saturating_sub(1);
                if rendered_y >= text_rect.y && rendered_y < text_rect.y + text_rect.height {
                    let x0 = text_rect.x + 1;
                    let keep_w = string_display_width(keep) as u16;
                    let gap_w = string_display_width("  ") as u16;
                    let revert_w = string_display_width(revert) as u16;

                    crate::click_map::register(
                        Rect {
                            x: x0,
                            y: rendered_y,
                            width: keep_w,
                            height: 1,
                        },
                        "diff_confirm",
                        rollback_id.clone(),
                    );
                    crate::click_map::register(
                        Rect {
                            x: x0 + keep_w + gap_w,
                            y: rendered_y,
                            width: revert_w,
                            height: 1,
                        },
                        "diff_revert",
                        rollback_id,
                    );
                }
            } else if part.kind == "workflow_progress" {
                // 结构化 workflow step
                let step_index = part.step_index.unwrap_or(0).max(1);
                let step_total = part.step_total.unwrap_or(0).max(1);
                let label = part.label.clone().unwrap_or_default();
                let status = part.status.clone().unwrap_or_else(|| "pending".to_string());
                let click_id = part
                    .action_id
                    .clone()
                    .unwrap_or_else(|| format!("step {step_index}/{step_total}"));

                let (glyph, badge, bar_style, badge_fg, badge_bg) = if status == "done" {
                    (
                        '●',
                        "[done]",
                        CellStyle {
                            fg: FG_BRAND,
                            bg: BG_TOOL,
                            ..Default::default()
                        },
                        BADGE_DONE_FG,
                        BADGE_DONE_BG,
                    )
                } else if status == "running" {
                    let anim = if state.tick % 2 == 0 { '◉' } else { '◍' };
                    (
                        anim,
                        "[···]",
                        CellStyle {
                            fg: FG_BRAND,
                            bg: BG_TOOL,
                            ..Default::default()
                        },
                        BADGE_RUN_FG,
                        BADGE_RUN_BG,
                    )
                } else if status == "error" {
                    (
                        '●',
                        "[err]",
                        CellStyle {
                            fg: crate::buffer::TermColor::Rgb(163, 45, 45),
                            bg: BG_TOOL,
                            ..Default::default()
                        },
                        BADGE_ERR_FG,
                        BADGE_ERR_BG,
                    )
                } else {
                    (
                        '○',
                        "[pending]",
                        CellStyle {
                            fg: FG_MUTED,
                            bg: BG_TOOL,
                            ..Default::default()
                        },
                        FG_GHOST,
                        BG_TOOL,
                    )
                };

                let base = format!("▏{} Step {}/{}  ", glyph, step_index, step_total);
                let badge_w = string_display_width(badge) as u16;
                let base_w = string_display_width(&base) as u16;
                // 这里必须用 text_rect（不含 scrollbar 列），避免 workflow 行溢出覆盖滚动条列造成“台阶”。
                let available = text_rect
                    .width
                    .saturating_sub(2)
                    .saturating_sub(base_w)
                    .saturating_sub(badge_w.saturating_add(1));
                let label_fit = truncate_to_width_end(&label, available);
                let line = format!("{}{}", base, label_fit);

                emit_line(
                    buf,
                    text_rect,
                    &visible,
                    &mut y,
                    &mut global_line,
                    &line,
                    bar_style,
                );
                let rendered_y = y.saturating_sub(1);
                if rendered_y >= text_rect.y && rendered_y < text_rect.y + text_rect.height {
                    write_badge_right(buf, text_rect, rendered_y, badge, badge_fg, badge_bg);

                    // 注册整行点击热区，用于 Week5：点击 workflow step 显示详情
                    let x0 = text_rect.x.saturating_add(1);
                    let w = text_rect.width.saturating_sub(2);
                    if w > 0 {
                        crate::click_map::register(
                            Rect {
                                x: x0,
                                y: rendered_y,
                                width: w,
                                height: 1,
                            },
                            "workflow_step",
                            click_id,
                        );
                    }
                }
            }
        }

        // 分隔线（40 字符，或按宽度缩短）
        let sep_len = (w as u16).min(40).max(10);
        emit_line(
            buf,
            text_rect,
            &visible,
            &mut y,
            &mut global_line,
            &repeat('─', sep_len),
            CellStyle {
                fg: FG_GHOST,
                bg: BG_PRIMARY,
                ..Default::default()
            },
        );

        // 空行
        emit_line(
            buf,
            text_rect,
            &visible,
            &mut y,
            &mut global_line,
            "",
            CellStyle {
                fg: FG_GHOST,
                bg: BG_PRIMARY,
                ..Default::default()
            },
        );
        if y >= text_rect.y + text_rect.height && global_line >= visible.end_line {
            break;
        }
    }

    // --- 滚动条绘制 ---
    if let Some(sb_rect) = state.layout.messages_scrollbar {
        let sb_rect = crate::layout::Rect::new(sb_rect.x, sb_rect.y, sb_rect.width, sb_rect.height);
        let viewport_h = sb_rect.height as u32;

        // 计算 Thumb 高度
        let thumb_h = if total_lines <= viewport_h || viewport_h == 0 {
            sb_rect.height
        } else {
            ((viewport_h * viewport_h) / total_lines).max(1) as u16
        };

        // 计算 Thumb 位置
        let max_thumb_top = sb_rect.height.saturating_sub(thumb_h);
        let thumb_top = if max_top_line == 0 {
            0
        } else {
            ((top_line as u64) * (max_thumb_top as u64) / (max_top_line as u64)) as u16
        };

        // 绘制轨道 (Track)
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

        // 绘制滑块 (Thumb)
        let thumb_style = CellStyle {
            fg: FG_BRAND,
            bg: FG_BRAND,
            ..Default::default()
        };
        let thumb_y0 = sb_rect.y + thumb_top;
        let thumb_y1 = (thumb_y0 + thumb_h).min(sb_rect.y + sb_rect.height);
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

pub struct MessageHeights {
    pub heights: Vec<u32>,
    pub cum_heights: Vec<u32>,
    pub total_lines: u32,
}

pub fn compute_message_heights(messages: &[String], width: u16) -> MessageHeights {
    let w = width.max(1) as usize;
    let mut heights = Vec::with_capacity(messages.len());
    let mut cum = Vec::with_capacity(messages.len());
    let mut total: u32 = 0;

    for m in messages {
        let mut h: u32 = 0;
        for line in m.lines() {
            h += wrap_text_to_width(line, w).len() as u32;
        }
        h = h.max(1);
        heights.push(h);
        cum.push(total);
        total = total.saturating_add(h);
    }

    MessageHeights {
        heights,
        cum_heights: cum,
        total_lines: total,
    }
}

pub struct VisibleRange {
    pub start_index: u32,
    pub start_line_offset: u32,
    pub end_index: u32,
}

pub fn find_visible_message_range(
    cum_heights: &[u32],
    heights: &[u32],
    offset: u32,
    h: u16,
) -> VisibleRange {
    if cum_heights.is_empty() || heights.is_empty() || h == 0 {
        return VisibleRange {
            start_index: 0,
            start_line_offset: 0,
            end_index: 0,
        };
    }

    let mut start = 0usize;
    for i in 0..cum_heights.len() {
        let top = cum_heights[i];
        let bottom = top.saturating_add(heights.get(i).copied().unwrap_or(0));
        if offset >= top && offset < bottom {
            start = i;
            break;
        }
        if offset < top {
            start = i;
            break;
        }
        start = i;
    }
    let start_top = cum_heights[start];
    let start_offset = offset.saturating_sub(start_top);

    let mut end = start;
    let mut remaining = h as u32;
    // 第一条从 start_offset 开始
    let first_h = heights
        .get(start)
        .copied()
        .unwrap_or(0)
        .saturating_sub(start_offset);
    if first_h >= remaining {
        return VisibleRange {
            start_index: start as u32,
            start_line_offset: start_offset,
            end_index: start as u32,
        };
    }
    remaining = remaining.saturating_sub(first_h.max(1));
    while remaining > 0 && end + 1 < heights.len() {
        end += 1;
        let hh = heights[end].max(1);
        if hh >= remaining {
            break;
        }
        remaining = remaining.saturating_sub(hh);
    }

    VisibleRange {
        start_index: start as u32,
        start_line_offset: start_offset,
        end_index: end as u32,
    }
}
