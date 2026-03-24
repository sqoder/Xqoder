use unicode_width::UnicodeWidthChar;

/// 返回字符在终端中的显示宽度（0 / 1 / 2）
pub fn char_display_width(c: char) -> u8 {
    match UnicodeWidthChar::width(c) {
        Some(0) => 0,
        Some(2) => 2,
        _ => 1,
    }
}

/// 计算字符串的终端显示宽度（考虑宽字符）
pub fn string_display_width(s: &str) -> usize {
    s.chars().map(|c| char_display_width(c) as usize).sum()
}

/// 截断字符串使其不超过 max_width 列
/// 如果截断点恰好在宽字符中间，用空格补位
pub fn truncate_to_width(s: &str, max_width: usize) -> String {
    let mut result = String::new();
    let mut width = 0usize;
    for c in s.chars() {
        let w = char_display_width(c) as usize;
        if width + w > max_width {
            // 宽字符被截断，用空格补位
            if w == 2 && width + 1 == max_width {
                result.push(' ');
            }
            break;
        }
        result.push(c);
        width += w;
    }

    result
}

#[cfg(test)]
mod tests {
    use super::{string_display_width, truncate_to_width};

    #[test]
    fn display_width_works_for_cjk() {
        assert_eq!(string_display_width("hello 世界"), 10);
    }

    #[test]
    fn truncation_respects_wide_char_boundary() {
        assert_eq!(truncate_to_width("AB中文CD", 5), "AB中 ");
    }
}
