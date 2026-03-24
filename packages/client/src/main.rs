use std::env;
use std::io::{BufRead, BufReader, IsTerminal, Write};
#[cfg(unix)]
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread;
use std::time::Duration;

use crossterm::event::{
    self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEvent, KeyModifiers,
    MouseButton, MouseEvent, MouseEventKind,
};
use crossterm::execute;
use crossterm::terminal::{disable_raw_mode, enable_raw_mode};

mod generated_version;
mod installer;
mod protocol;

const CLIENT_VERSION: &str = generated_version::XQODER_VERSION;

struct TerminalModeGuard;

impl TerminalModeGuard {
    fn activate() -> Option<Self> {
        if enable_raw_mode().is_err() {
            return None;
        }
        if execute!(std::io::stdout(), EnableMouseCapture).is_err() {
            let _ = disable_raw_mode();
            return None;
        }
        Some(Self)
    }
}

impl Drop for TerminalModeGuard {
    fn drop(&mut self) {
        let _ = execute!(std::io::stdout(), DisableMouseCapture);
        let _ = disable_raw_mode();
    }
}

fn key_event_to_seq(key: &KeyEvent) -> Option<String> {
    if key.modifiers.contains(KeyModifiers::CONTROL) {
        if let KeyCode::Char(c) = key.code {
            let lower = c.to_ascii_lowercase() as u8;
            if lower.is_ascii_lowercase() {
                return Some(((lower - b'a' + 1) as char).to_string());
            }
        }
    }

    match key.code {
        KeyCode::Char(c) => Some(c.to_string()),
        KeyCode::Enter => Some("\n".to_string()),
        KeyCode::Backspace => Some("\u{007f}".to_string()),
        KeyCode::Tab => Some("\t".to_string()),
        KeyCode::Esc => Some("\u{001b}".to_string()),
        KeyCode::Up => Some("\u{001b}[A".to_string()),
        KeyCode::Down => Some("\u{001b}[B".to_string()),
        KeyCode::Right => Some("\u{001b}[C".to_string()),
        KeyCode::Left => Some("\u{001b}[D".to_string()),
        _ => None,
    }
}

fn mouse_event_to_sgr(mouse: &MouseEvent) -> Option<String> {
    let mut modifiers = 0u16;
    if mouse.modifiers.contains(KeyModifiers::SHIFT) {
        modifiers |= 4;
    }
    if mouse.modifiers.contains(KeyModifiers::ALT) {
        modifiers |= 8;
    }
    if mouse.modifiers.contains(KeyModifiers::CONTROL) {
        modifiers |= 16;
    }

    let (cb, suffix) = match mouse.kind {
        MouseEventKind::Down(button) => {
            let base = match button {
                MouseButton::Left => 0,
                MouseButton::Middle => 1,
                MouseButton::Right => 2,
            };
            (base + modifiers, 'M')
        }
        MouseEventKind::Up(_) => (3 + modifiers, 'm'),
        MouseEventKind::Drag(button) => {
            let base = match button {
                MouseButton::Left => 0,
                MouseButton::Middle => 1,
                MouseButton::Right => 2,
            };
            (32 + base + modifiers, 'M')
        }
        MouseEventKind::Moved => (35 + modifiers, 'M'),
        MouseEventKind::ScrollUp => (64 + modifiers, 'M'),
        MouseEventKind::ScrollDown => (65 + modifiers, 'M'),
        MouseEventKind::ScrollLeft => return None,
        MouseEventKind::ScrollRight => return None,
    };

    let col = mouse.column.saturating_add(1);
    let row = mouse.row.saturating_add(1);
    Some(format!("\u{001b}[<{};{};{}{}", cb, col, row, suffix))
}

fn main() {
    if env::args().any(|arg| arg == "--version" || arg == "-V") {
        println!("{CLIENT_VERSION}");
        return;
    }

    #[cfg(not(unix))]
    {
        eprintln!(
            "xqoder: Rust daemon client is currently supported on Unix/macOS only. \
Use the Node CLI path on Windows for now (for example: `pnpm xqoder -- tui`). \
See: docs/support/platform-support-matrix.md"
        );
        std::process::exit(1);
    }

    #[cfg(unix)]
    run_unix();
}

fn detect_installed_daemon_entry() -> Option<String> {
    let install_root = if let Ok(value) = env::var("XQODER_INSTALL_ROOT") {
        Some(PathBuf::from(value))
    } else {
        let exe = env::current_exe().ok()?;
        exe.parent()?.parent().map(|p| p.to_path_buf())
    }?;

    let packaged = install_root
        .join("node_modules")
        .join("@xqoder")
        .join("daemon")
        .join("dist")
        .join("server.js");
    if packaged.exists() {
        return Some(packaged.to_string_lossy().to_string());
    }

    None
}

#[cfg(unix)]
fn run_unix() {
    let node_binary = env::var("XQODER_NODE").unwrap_or_else(|_| "node".to_string());
    let daemon_entry = env::var("XQODER_DAEMON")
        .ok()
        .or_else(detect_installed_daemon_entry)
        .unwrap_or_else(|| {
            "/usr/local/lib/xqoder/node_modules/@xqoder/daemon/dist/server.js".to_string()
        });

    if !installer::ensure_daemon_running(&node_binary, &daemon_entry) {
        eprintln!("xqoder: daemon startup timeout. Try: xqoder daemon start");
        std::process::exit(1);
    }

    let socket_path = installer::get_socket_path();
    let stream = UnixStream::connect(&socket_path).unwrap_or_else(|e| {
        eprintln!("xqoder: cannot connect to daemon: {e}");
        std::process::exit(1);
    });
    let _ = stream.set_read_timeout(Some(Duration::from_millis(120)));

    let mut writer = stream.try_clone().unwrap_or_else(|e| {
        eprintln!("xqoder: cannot clone daemon stream: {e}");
        std::process::exit(1);
    });
    let mut reader = BufReader::new(stream);

    let _ = writer.write_all(
        protocol::encode(&protocol::ClientMessage::Attach {
            version: CLIENT_VERSION.to_string(),
        })
        .as_bytes(),
    );

    let (cols, rows) = crossterm::terminal::size().unwrap_or((80, 24));
    let _ = writer
        .write_all(protocol::encode(&protocol::ClientMessage::Resize { cols, rows }).as_bytes());

    let mut warned_frame_protocol = false;

    let running = Arc::new(AtomicBool::new(true));
    let interactive = std::io::stdin().is_terminal() && std::io::stdout().is_terminal();
    let mut terminal_guard: Option<TerminalModeGuard> = None;
    let mut input_thread = None;

    if interactive {
        let input_running = Arc::clone(&running);
        let mut input_writer = writer.try_clone().unwrap_or_else(|e| {
            eprintln!("xqoder: cannot clone daemon writer for input thread: {e}");
            std::process::exit(1);
        });

        terminal_guard = match TerminalModeGuard::activate() {
            Some(guard) => Some(guard),
            None => {
                eprintln!("xqoder: cannot enter raw terminal mode");
                std::process::exit(1);
            }
        };

        input_thread = Some(thread::spawn(move || {
            while input_running.load(Ordering::Relaxed) {
                if !event::poll(Duration::from_millis(50)).unwrap_or(false) {
                    continue;
                }

                match event::read() {
                    Ok(Event::Key(key_event)) => {
                        if let Some(seq) = key_event_to_seq(&key_event) {
                            if input_writer
                                .write_all(
                                    protocol::encode(&protocol::ClientMessage::Key { data: seq })
                                        .as_bytes(),
                                )
                                .is_err()
                            {
                                break;
                            }
                        }
                        if key_event.code == KeyCode::Char('c')
                            && key_event.modifiers.contains(KeyModifiers::CONTROL)
                        {
                            let _ = input_writer.write_all(
                                protocol::encode(&protocol::ClientMessage::Detach).as_bytes(),
                            );
                            input_running.store(false, Ordering::Relaxed);
                            break;
                        }
                    }
                    Ok(Event::Mouse(mouse_event)) => {
                        if let Some(seq) = mouse_event_to_sgr(&mouse_event) {
                            let _ = input_writer.write_all(
                                protocol::encode(&protocol::ClientMessage::Mouse { seq })
                                    .as_bytes(),
                            );
                        }
                    }
                    Ok(Event::Resize(cols, rows)) => {
                        let _ = input_writer.write_all(
                            protocol::encode(&protocol::ClientMessage::Resize { cols, rows })
                                .as_bytes(),
                        );
                    }
                    Ok(_) => {}
                    Err(_) => break,
                }
            }
        }));
    }

    let mut line = String::new();
    while running.load(Ordering::Relaxed) {
        line.clear();
        let read_result = reader.read_line(&mut line);
        let bytes = match read_result {
            Ok(value) => value,
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut =>
            {
                continue;
            }
            Err(_) => break,
        };
        if bytes == 0 {
            break;
        }

        let line = line.trim_end_matches(['\r', '\n']).to_string();

        if let Some(msg) = protocol::decode_line(&line) {
            match msg {
                protocol::DaemonMessage::Frame { cells } => {
                    if !warned_frame_protocol {
                        eprintln!(
                            "xqoder: received deprecated frame payload ({} cells); ignoring in ANSI-only mode",
                            cells.len()
                        );
                        warned_frame_protocol = true;
                    }
                }
                protocol::DaemonMessage::Ansi { data } => {
                    print!("{}", data);
                    let _ = std::io::stdout().flush();
                }
                protocol::DaemonMessage::Ready { version } => {
                    eprintln!("Connected to daemon v{version}");
                }
                protocol::DaemonMessage::Restart => {
                    eprintln!("Daemon restarting...");
                    break;
                }
                protocol::DaemonMessage::Error { message, code } => {
                    if let Some(code) = code {
                        eprintln!("Daemon error [{code}]: {message}");
                    } else {
                        eprintln!("Daemon error: {message}");
                    }
                }
                protocol::DaemonMessage::Pong => {}
            }
        }
    }

    running.store(false, Ordering::Relaxed);
    let _ = writer.write_all(protocol::encode(&protocol::ClientMessage::Detach).as_bytes());
    if let Some(handle) = input_thread {
        let _ = handle.join();
    }
    drop(terminal_guard);
}
