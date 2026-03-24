pub const MOUSE_ENABLE: &str = "\x1b[?1000h\x1b[?1006h\x1b[?1003h";
pub const MOUSE_DISABLE: &str = "\x1b[?1000l\x1b[?1006l\x1b[?1003l";

#[derive(Debug, Clone, PartialEq)]
pub enum MouseButton {
    Left,
    Middle,
    Right,
    None,
}

#[derive(Debug, Clone, PartialEq)]
pub enum MouseEventKind {
    Press,
    Release,
    Move,
    ScrollUp,
    ScrollDown,
}

#[derive(Debug, Clone)]
pub struct MouseEvent {
    pub kind: MouseEventKind,
    pub button: MouseButton,
    pub col: u16,
    pub row: u16,
    pub shift: bool,
    pub alt: bool,
    pub ctrl: bool,
}

pub fn parse_sgr_mouse(seq: &str) -> Option<MouseEvent> {
    let inner = seq.strip_prefix("\x1b[<")?;
    let (nums_str, is_press) = if let Some(s) = inner.strip_suffix('M') {
        (s, true)
    } else if let Some(s) = inner.strip_suffix('m') {
        (s, false)
    } else {
        return None;
    };

    let parts: Vec<&str> = nums_str.splitn(3, ';').collect();
    if parts.len() != 3 {
        return None;
    }

    let cb: u32 = parts[0].parse().ok()?;
    let cx: u16 = parts[1].parse::<u16>().ok()?.saturating_sub(1);
    let cy: u16 = parts[2].parse::<u16>().ok()?.saturating_sub(1);

    let btn_bits = cb & 0b11;
    let shift = (cb & 4) != 0;
    let alt = (cb & 8) != 0;
    let ctrl = (cb & 16) != 0;
    let is_motion = (cb & 32) != 0;
    let is_scroll = (cb & 96) == 64;

    let (kind, button) = if is_scroll {
        let kind = if btn_bits == 0 {
            MouseEventKind::ScrollUp
        } else {
            MouseEventKind::ScrollDown
        };
        (kind, MouseButton::None)
    } else if is_motion {
        (MouseEventKind::Move, MouseButton::None)
    } else {
        let button = match btn_bits {
            0 => MouseButton::Left,
            1 => MouseButton::Middle,
            2 => MouseButton::Right,
            _ => MouseButton::None,
        };
        let kind = if is_press {
            MouseEventKind::Press
        } else {
            MouseEventKind::Release
        };
        (kind, button)
    };

    Some(MouseEvent {
        kind,
        button,
        col: cx,
        row: cy,
        shift,
        alt,
        ctrl,
    })
}

pub struct ScrollPhysics {
    velocity: f32,
    last_tick: std::time::Instant,
    friction: f32,
    max_vel: f32,
}

impl Default for ScrollPhysics {
    fn default() -> Self {
        Self {
            velocity: 0.0,
            last_tick: std::time::Instant::now(),
            friction: 0.88,
            max_vel: 40.0,
        }
    }
}

impl ScrollPhysics {
    pub fn tick(&mut self, direction: f32) -> f32 {
        let now = std::time::Instant::now();
        let dt = now.duration_since(self.last_tick).as_millis() as f32;
        self.last_tick = now;

        let impulse = if dt < 50.0 {
            4.0
        } else if dt < 100.0 {
            2.5
        } else {
            1.2
        };
        self.velocity = (self.velocity.abs() + impulse).min(self.max_vel) * direction;
        self.velocity
    }

    pub fn decay(&mut self) -> f32 {
        self.velocity *= self.friction;
        if self.velocity.abs() < 0.3 {
            self.velocity = 0.0;
        }
        self.velocity
    }

    pub fn reset(&mut self) {
        self.velocity = 0.0;
    }

    pub fn velocity(&self) -> f32 {
        self.velocity
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_sgr_mouse, MouseButton, MouseEventKind};

    #[test]
    fn parse_press() {
        let ev = parse_sgr_mouse("\x1b[<0;42;15M").expect("expected mouse event");
        assert_eq!(ev.kind, MouseEventKind::Press);
        assert_eq!(ev.button, MouseButton::Left);
        assert_eq!(ev.col, 41);
        assert_eq!(ev.row, 14);
    }

    #[test]
    fn parse_scroll() {
        let up = parse_sgr_mouse("\x1b[<64;10;5M").expect("expected scroll up");
        assert_eq!(up.kind, MouseEventKind::ScrollUp);
        let down = parse_sgr_mouse("\x1b[<65;10;5M").expect("expected scroll down");
        assert_eq!(down.kind, MouseEventKind::ScrollDown);
    }

    #[test]
    fn parse_invalid_returns_none() {
        assert!(parse_sgr_mouse("invalid").is_none());
    }
}
