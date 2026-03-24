use crate::unicode::char_display_width;

pub fn wrap_text_to_width(text: &str, max_width: usize) -> Vec<String> {
    if max_width == 0 {
        return vec![String::new()];
    }

    if text.is_empty() {
        return vec![String::new()];
    }

    let mut rows = Vec::new();
    let mut current = String::new();
    let mut current_width = 0usize;

    for ch in text.chars() {
        let char_width = usize::from(char_display_width(ch).max(1));
        if current_width + char_width > max_width && !current.is_empty() {
            rows.push(current);
            current = String::new();
            current_width = 0;
        }
        current.push(ch);
        current_width += char_width;
    }

    rows.push(current);
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_cjk_without_inserting_spaces() {
        let rows = wrap_text_to_width("你好世界", 4);
        assert_eq!(rows, vec!["你好".to_string(), "世界".to_string()]);
    }

    #[test]
    fn wraps_ascii() {
        let rows = wrap_text_to_width("abcdef", 3);
        assert_eq!(rows, vec!["abc".to_string(), "def".to_string()]);
    }
}
