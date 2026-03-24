pub fn inertial_scroll_deltas(delta: i32, steps: u8) -> Vec<i32> {
    let mut remaining = delta;
    let mut out = Vec::new();
    for _ in 0..steps.max(1) {
        if remaining == 0 {
            break;
        }
        out.push(remaining);
        remaining = (remaining * 2) / 3;
        if remaining > 0 {
            remaining -= 1;
        } else if remaining < 0 {
            remaining += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decays_towards_zero() {
        let seq = inertial_scroll_deltas(6, 6);
        assert!(!seq.is_empty());
        assert_eq!(seq[0], 6);
        assert!(seq[seq.len() - 1].abs() <= 2);
    }
}
