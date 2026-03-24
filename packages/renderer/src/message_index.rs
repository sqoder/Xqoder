#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntryHeightCache {
    pub heights: Vec<u32>,
    pub cum_heights: Vec<u32>,
    pub total_lines: u32,
}

pub fn build_entry_height_cache(starts: &[u32], ends: &[u32]) -> EntryHeightCache {
    let len = starts.len().min(ends.len());
    let mut heights = Vec::with_capacity(len);
    let mut cum_heights = Vec::with_capacity(len);
    let mut running_total = 0u32;

    for i in 0..len {
        let start = starts[i];
        let end = ends[i];
        let height = if end >= start {
            end.saturating_sub(start).saturating_add(1)
        } else {
            0
        };
        heights.push(height);
        running_total = running_total.saturating_add(height);
        cum_heights.push(running_total);
    }

    EntryHeightCache {
        heights,
        cum_heights,
        total_lines: running_total,
    }
}

pub fn find_entry_range_index(starts: &[u32], ends: &[u32], line: u32) -> i32 {
    let len = starts.len().min(ends.len());
    if len == 0 {
        return -1;
    }

    let mut left = 0usize;
    let mut right = len;
    while left < right {
        let mid = left + (right - left) / 2;
        let start = starts[mid];
        if start <= line {
            left = mid + 1;
        } else {
            right = mid;
        }
    }

    if left == 0 {
        return -1;
    }

    let idx = left - 1;
    if line <= ends[idx] {
        idx as i32
    } else {
        -1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_height_cache() {
        let starts = vec![0, 3, 8];
        let ends = vec![2, 6, 9];
        let cache = build_entry_height_cache(&starts, &ends);
        assert_eq!(cache.heights, vec![3, 4, 2]);
        assert_eq!(cache.cum_heights, vec![3, 7, 9]);
        assert_eq!(cache.total_lines, 9);
    }

    #[test]
    fn binary_search_finds_range() {
        let starts = vec![0, 3, 8];
        let ends = vec![2, 6, 9];
        assert_eq!(find_entry_range_index(&starts, &ends, 0), 0);
        assert_eq!(find_entry_range_index(&starts, &ends, 4), 1);
        assert_eq!(find_entry_range_index(&starts, &ends, 9), 2);
        assert_eq!(find_entry_range_index(&starts, &ends, 7), -1);
    }
}
