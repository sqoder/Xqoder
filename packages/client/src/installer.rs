use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use sha1::{Digest, Sha1};

use crate::generated_version::XQODER_VERSION;

fn normalized_channel() -> String {
    let raw = env::var("XQODER_CHANNEL").unwrap_or_else(|_| "stable".to_string());
    let trimmed = raw.trim();
    let base = if trimmed.is_empty() {
        "stable"
    } else {
        trimmed
    };
    base.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '-'
            }
        })
        .collect()
}

fn workspace_root() -> PathBuf {
    let candidate = env::var("XQODER_WORKSPACE_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    fs::canonicalize(&candidate).unwrap_or(candidate)
}

fn workspace_hash(root: &Path) -> String {
    let mut hasher = Sha1::new();
    hasher.update(root.to_string_lossy().as_bytes());
    let digest = hasher.finalize();
    format!("{:x}", digest)[0..8].to_string()
}

fn run_base_directory() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
        return PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("xqoder")
            .join("run");
    }

    #[cfg(target_os = "windows")]
    {
        let local_app_data = env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
        return PathBuf::from(local_app_data).join("xqoder").join("run");
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Ok(state_home) = env::var("XDG_STATE_HOME") {
            return PathBuf::from(state_home).join("xqoder").join("run");
        }
        let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
        return PathBuf::from(home)
            .join(".local")
            .join("state")
            .join("xqoder")
            .join("run");
    }

    #[allow(unreachable_code)]
    PathBuf::from(".xqoder/run")
}

fn run_directory() -> PathBuf {
    let root = workspace_root();
    let hash = workspace_hash(&root);
    run_base_directory()
        .join(normalized_channel())
        .join(format!("{}-v{}", hash, XQODER_VERSION))
}

pub fn get_socket_path() -> PathBuf {
    let run_dir = run_directory();

    #[cfg(unix)]
    {
        return run_dir.join("daemon.sock");
    }

    #[cfg(windows)]
    {
        let hash = workspace_hash(&workspace_root());
        return PathBuf::from(format!(
            "\\\\.\\pipe\\xqoder-daemon-{}-{}-{}",
            normalized_channel(),
            XQODER_VERSION,
            hash,
        ));
    }

    #[allow(unreachable_code)]
    run_dir.join("daemon.sock")
}

pub fn get_ready_file() -> PathBuf {
    run_directory().join("daemon.ready")
}

pub fn get_pid_file() -> PathBuf {
    run_directory().join("daemon.pid")
}

pub fn get_health_file() -> PathBuf {
    run_directory().join("daemon.health.json")
}

pub fn ensure_daemon_running(node_binary: &str, daemon_entry: &str) -> bool {
    let ready_file = get_ready_file();
    let socket_path = get_socket_path();

    if ready_file.exists() && socket_path.exists() {
        return true;
    }

    let _ = fs::remove_file(&ready_file);
    let _ = fs::remove_file(get_pid_file());

    let workspace_root = workspace_root();
    let _ = Command::new(node_binary)
        .arg(daemon_entry)
        .current_dir(&workspace_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .env("XQODER_WORKSPACE_ROOT", workspace_root.as_os_str())
        .spawn();

    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if ready_file.exists() {
            return true;
        }
        thread::sleep(Duration::from_millis(50));
    }

    false
}
