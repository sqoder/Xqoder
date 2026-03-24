#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VisibleRange {
    pub start_line: u32,
    pub end_line: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScrollbarThumb {
    pub visible: bool,
    pub thumb_top: u32,
    pub thumb_height: u32,
    pub track_height: u32,
}

pub fn compute_visible_range(line_count: u32, top_line: u32, height: u32) -> VisibleRange {
    let visible_capacity = height.max(1);
    let max_top = line_count.saturating_sub(visible_capacity);
    let clamped_top = top_line.min(max_top);
    let end_line = line_count.min(clamped_top.saturating_add(visible_capacity));

    VisibleRange {
        start_line: clamped_top,
        end_line,
    }
}

pub fn compute_scrollbar_thumb(
    content_height: u32,
    viewport_height: u32,
    scroll_top: u32,
    track_height: u32,
) -> ScrollbarThumb {
    let track_height = track_height.max(1);
    let viewport_height = viewport_height.max(1);

    if content_height <= viewport_height {
        return ScrollbarThumb {
            visible: false,
            thumb_top: 0,
            thumb_height: track_height,
            track_height,
        };
    }

    let proportional =
        ((viewport_height as u64) * (track_height as u64) / (content_height as u64)) as u32;
    let thumb_height = proportional.max(3).min(track_height);
    let max_thumb_top = track_height.saturating_sub(thumb_height);
    let scroll_range = content_height.saturating_sub(viewport_height);
    let clamped_scroll = scroll_top.min(scroll_range);
    let thumb_top = if max_thumb_top == 0 || scroll_range == 0 {
        0
    } else {
        ((clamped_scroll as u64) * (max_thumb_top as u64) / (scroll_range as u64)) as u32
    };

    ScrollbarThumb {
        visible: true,
        thumb_top,
        thumb_height,
        track_height,
    }
}

pub fn resolve_top_line_from_scrollbar(
    line_count: u32,
    height: u32,
    pointer_row: i32,
    drag_offset: i32,
) -> u32 {
    let viewport_height = height.max(1);
    let max_top_line = line_count.saturating_sub(viewport_height);
    if max_top_line == 0 {
        return 0;
    }

    let scrollbar = compute_scrollbar_thumb(line_count, viewport_height, 0, viewport_height);
    if !scrollbar.visible {
        return 0;
    }

    let max_thumb_top = scrollbar
        .track_height
        .saturating_sub(scrollbar.thumb_height);
    if max_thumb_top == 0 {
        return 0;
    }

    let raw_top = pointer_row.saturating_sub(drag_offset);
    let clamped_thumb_top = raw_top.clamp(0, max_thumb_top as i32) as u32;
    ((clamped_thumb_top as u64) * (max_top_line as u64) / (max_thumb_top as u64)) as u32
}

pub fn resolve_top_line_for_jump(
    line_count: u32,
    height: u32,
    target_line: u32,
    anchor_numerator: u32,
    anchor_denominator: u32,
) -> u32 {
    let viewport_height = height.max(1);
    let max_top_line = line_count.saturating_sub(viewport_height);
    let safe_denominator = anchor_denominator.max(1);
    let anchor_offset =
        ((viewport_height as u64) * (anchor_numerator as u64) / (safe_denominator as u64)) as u32;
    let desired_top = target_line.saturating_sub(anchor_offset);
    desired_top.min(max_top_line)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_contract_fixture() -> (Vec<u32>, Vec<u32>, u32) {
        let entry_heights = [3u32, 4, 2, 5, 3];
        let mut starts = Vec::with_capacity(entry_heights.len());
        let mut ends = Vec::with_capacity(entry_heights.len());
        let mut line = 0u32;
        for height in entry_heights {
            starts.push(line);
            ends.push(line + height - 1);
            line += height;
        }
        (starts, ends, line)
    }

    #[test]
    fn visible_range_clamps_top() {
        let range = compute_visible_range(100, 97, 10);
        assert_eq!(range.start_line, 90);
        assert_eq!(range.end_line, 100);
    }

    #[test]
    fn scrollbar_hidden_when_content_fits() {
        let thumb = compute_scrollbar_thumb(20, 20, 0, 20);
        assert!(!thumb.visible);
        assert_eq!(thumb.thumb_height, 20);
    }

    #[test]
    fn scrollbar_thumb_in_range() {
        let thumb = compute_scrollbar_thumb(120, 20, 30, 20);
        assert!(thumb.visible);
        assert!(thumb.thumb_height >= 3);
        assert!(thumb.thumb_top <= 20 - thumb.thumb_height);
    }

    #[test]
    fn resolve_top_line_from_scrollbar_clamps() {
        let top = resolve_top_line_from_scrollbar(120, 20, 999, 0);
        assert_eq!(top, 100);
    }

    #[test]
    fn resolve_top_line_for_jump_keeps_target_visible() {
        let top = resolve_top_line_for_jump(120, 20, 60, 1, 3);
        assert_eq!(top, 54);

        let near_bottom = resolve_top_line_for_jump(120, 20, 119, 1, 3);
        assert_eq!(near_bottom, 100);
    }

    #[test]
    fn contract_fixture_jump_projection_matches_expected_anchor() {
        let (_, _, total_lines) = build_contract_fixture();
        let viewport_height = 6;
        let targets = [0u32, 4, 8, total_lines - 1];

        for target in targets {
            let top = resolve_top_line_for_jump(total_lines, viewport_height, target, 1, 3);
            let expected = target.saturating_sub(2).min(total_lines - viewport_height);
            assert_eq!(top, expected);
            assert!(target >= top);
            assert!(target < top + viewport_height || top == total_lines - viewport_height);
        }
    }

    #[test]
    fn contract_fixture_scrollbar_round_trip_stays_stable() {
        let (_, _, total_lines) = build_contract_fixture();
        let viewport_height = 6;
        let scroll_offsets = [0u32, 2, 5, total_lines - viewport_height];

        for scroll_offset in scroll_offsets {
            let thumb = compute_scrollbar_thumb(
                total_lines,
                viewport_height,
                scroll_offset,
                viewport_height,
            );
            assert!(thumb.visible);

            let pointer_row = (thumb.thumb_top + (thumb.thumb_height / 2)) as i32;
            let projected_top =
                resolve_top_line_from_scrollbar(total_lines, viewport_height, pointer_row, 0);
            let next_thumb = compute_scrollbar_thumb(
                total_lines,
                viewport_height,
                projected_top,
                viewport_height,
            );

            assert!((next_thumb.thumb_top as i32 - thumb.thumb_top as i32).abs() <= 1);
        }
    }
}
