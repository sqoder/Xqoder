use crate::layout::Layout;

#[derive(Debug, Clone, PartialEq)]
pub enum HitTarget {
    DiffConfirm { rollback_point_id: String },
    DiffRevert { rollback_point_id: String },
    WorkflowStep { id: String },
    Message { line_offset: u16 },
    InputArea,
    Sidebar { row: u16 },
    Scrollbar { ratio: f32 },
    Header,
    Footer,
    Overlay { row: u16 },
    None,
}

pub fn hit_test(col: u16, row: u16, layout: &Layout) -> HitTarget {
    if let Some(region) = crate::click_map::hit(col, row) {
        if region.kind == "diff_confirm" {
            return HitTarget::DiffConfirm {
                rollback_point_id: region.id,
            };
        }
        if region.kind == "diff_revert" {
            return HitTarget::DiffRevert {
                rollback_point_id: region.id,
            };
        }
        if region.kind == "workflow_step" {
            return HitTarget::WorkflowStep { id: region.id };
        }
    }

    if let Some(overlay) = &layout.overlay {
        if overlay.contains(col, row) {
            return HitTarget::Overlay {
                row: row.saturating_sub(overlay.y),
            };
        }
    }

    if layout.input.contains(col, row) {
        return HitTarget::InputArea;
    }
    if layout.header.contains(col, row) {
        return HitTarget::Header;
    }
    if layout.footer.contains(col, row) {
        return HitTarget::Footer;
    }

    if layout.has_sidebar && layout.sidebar.contains(col, row) {
        return HitTarget::Sidebar {
            row: row.saturating_sub(layout.sidebar.y),
        };
    }

    if let Some(sb) = &layout.messages_scrollbar {
        if sb.contains(col, row) {
            let ratio = row.saturating_sub(sb.y) as f32 / sb.height.max(1) as f32;
            return HitTarget::Scrollbar {
                ratio: ratio.clamp(0.0, 1.0),
            };
        }
    }

    if layout.messages.contains(col, row) {
        return HitTarget::Message {
            line_offset: row.saturating_sub(layout.messages.y),
        };
    }

    HitTarget::None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_sidebar_and_scrollbar() {
        let layout = crate::layout::compute_layout(140, 30, 1, None, None);
        let scrollbar = layout.messages_scrollbar.expect("scrollbar rect");
        assert!(matches!(
            hit_test(120, 2, &layout),
            HitTarget::Sidebar { .. }
        ));
        assert!(matches!(
            hit_test(scrollbar.x, scrollbar.y + 1, &layout),
            HitTarget::Scrollbar { .. }
        ));
    }

    #[test]
    fn routes_message_and_input() {
        let layout = crate::layout::compute_layout(100, 24, 2, None, None);
        assert!(matches!(
            hit_test(layout.messages.x + 2, layout.messages.y + 2, &layout),
            HitTarget::Message { .. }
        ));
        assert_eq!(
            hit_test(layout.input.x + 1, layout.input.y + 1, &layout),
            HitTarget::InputArea
        );
    }
}
