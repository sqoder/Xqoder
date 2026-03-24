pub fn is_folded_diff_marker(line: &str) -> bool {
    let trimmed = line.trim();
    if !trimmed.starts_with("...") {
        return false;
    }
    trimmed.contains("unchanged lines") && trimmed.contains("(folded")
}

pub fn folded_marker_hidden_count(line: &str) -> u32 {
    if !is_folded_diff_marker(line) {
        return 0;
    }
    let mut parts = line.split_whitespace();
    let _ = parts.next();
    parts
        .next()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(0)
}

pub fn is_context_read_tool(tool_name: &str) -> bool {
    let lower = tool_name.trim().to_ascii_lowercase();
    lower.contains("read")
        || lower.contains("grep")
        || lower.contains("glob")
        || lower.contains("search")
}

pub fn context_group_label(reads: u32) -> String {
    format!("Gathered context · {} reads", reads.max(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_folded_marker() {
        assert!(is_folded_diff_marker(
            "... 12 unchanged lines (folded, press Enter)"
        ));
        assert_eq!(
            folded_marker_hidden_count("... 12 unchanged lines (folded, press Enter)"),
            12
        );
    }

    #[test]
    fn detects_context_tools() {
        assert!(is_context_read_tool("read"));
        assert!(is_context_read_tool("grep"));
        assert!(!is_context_read_tool("bash"));
    }
}
