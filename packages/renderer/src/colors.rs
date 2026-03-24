use crate::buffer::TermColor;

// 背景（只有两种）
pub const BG_PRIMARY: TermColor = TermColor::Rgb(13, 13, 15); // #0D0D0F
pub const BG_TOOL: TermColor = TermColor::Rgb(19, 19, 26); // #13131A

// 文字色阶（语义化）
pub const FG_PRIMARY: TermColor = TermColor::Rgb(200, 200, 220);
pub const FG_SECONDARY: TermColor = TermColor::Rgb(144, 144, 176);
pub const FG_MUTED: TermColor = TermColor::Rgb(107, 107, 138);
pub const FG_FAINT: TermColor = TermColor::Rgb(61, 61, 82);
pub const FG_GHOST: TermColor = TermColor::Rgb(37, 37, 48);

// 品牌
pub const FG_BRAND: TermColor = TermColor::Rgb(124, 58, 237); // #7C3AED

// Badge
pub const BADGE_DONE_BG: TermColor = TermColor::Rgb(26, 46, 26);
pub const BADGE_DONE_FG: TermColor = TermColor::Rgb(59, 109, 17);
pub const BADGE_RUN_BG: TermColor = TermColor::Rgb(30, 26, 46);
pub const BADGE_RUN_FG: TermColor = TermColor::Rgb(124, 58, 237);
pub const BADGE_ERR_BG: TermColor = TermColor::Rgb(46, 26, 26);
pub const BADGE_ERR_FG: TermColor = TermColor::Rgb(163, 45, 45);

// Pills
pub const PILL_FILE_BG: TermColor = TermColor::Rgb(37, 99, 235);
