//! Feria dev registry lifecycle management.
//!
//! Feria is the host-local npm dev registry running at `http://127.0.0.1:4873`
//! that the Lamaste ecosystem depends on to resolve `@lamalibre/*` packages
//! during development and E2E testing. This module lets the desktop app observe
//! and control a feria instance so users never have to keep a terminal open.
//!
//! Every function here is synchronous (blocking HTTP via `reqwest::blocking`,
//! blocking `std::process::Child`). All Tauri commands wrap invocations in
//! `tokio::task::spawn_blocking` so the Tauri event loop is never blocked.

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use reqwest::blocking::Client;
use serde::Serialize;

pub const FERIA_URL: &str = "http://127.0.0.1:4873";

const REACHABILITY_TIMEOUT_MS: u64 = 800;

/// Max wall time we wait for a freshly-spawned feria to become reachable
/// before reporting a start failure.
const START_READY_TIMEOUT_MS: u64 = 8_000;
const START_POLL_INTERVAL_MS: u64 = 200;

/// Check whether feria is reachable.
pub fn is_reachable() -> bool {
    let client = match Client::builder()
        .timeout(Duration::from_millis(REACHABILITY_TIMEOUT_MS))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    client
        .get(format!("{}/api/releases", FERIA_URL))
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

// ─────────────────────────────────────────────────────────────────────────
// Process lifecycle
// ─────────────────────────────────────────────────────────────────────────

/// Holds the child process handle for a feria instance that *this* app
/// spawned. `None` means feria isn't running, or it was started externally.
fn managed() -> &'static Mutex<Option<Child>> {
    static MANAGED: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
    MANAGED.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FeriaProcessStatus {
    /// One of: `stopped` | `managed-running` | `external-running` | `starting` | `error`.
    pub state: String,
    /// Resolved invocation for the feria binary, if discovery succeeded.
    pub binary: Option<String>,
    /// Pid of the managed child, if any.
    pub pid: Option<u32>,
    /// Human-readable error when `state == "error"`.
    pub error: Option<String>,
    /// True when `state == "managed-running"` so the UI can show a Stop button.
    pub ownable: bool,
}

/// Resolve how to invoke feria. Strategy, in order:
///
/// 1. `LAMALIBRE_FERIA_BIN` env var (escape hatch).
/// 2. `feria-server` on `$PATH` (global install of `@lamalibre/feria-server`).
/// 3. Sibling-repo walk: feria now lives in its own repository
///    (`https://github.com/lamalibre/feria`), typically checked out next to
///    the lamaste repo. Walk up from cwd looking for
///    `<parent>/feria/packages/server/cli/bin/feria-server.mjs`.
pub fn discover_feria_binary() -> Result<(String, Vec<String>), String> {
    if let Ok(path) = std::env::var("LAMALIBRE_FERIA_BIN") {
        if !path.is_empty() {
            if path.ends_with(".js") || path.ends_with(".mjs") {
                return Ok(("node".to_string(), vec![path]));
            }
            return Ok((path, vec![]));
        }
    }

    // Check $PATH for a globally installed feria-server binary.
    if let Ok(path_env) = std::env::var("PATH") {
        for dir in path_env.split(':') {
            let candidate = Path::new(dir).join("feria-server");
            if candidate.is_file() {
                return Ok((candidate.to_string_lossy().into_owned(), vec![]));
            }
        }
    }

    // Walk up from cwd looking for the feria sibling repo:
    // <ancestor>/feria/packages/server/cli/bin/feria-server.mjs
    if let Ok(cwd) = std::env::current_dir() {
        let mut cursor: Option<&Path> = Some(cwd.as_path());
        while let Some(dir) = cursor {
            let candidate = dir
                .join("feria")
                .join("packages")
                .join("server")
                .join("cli")
                .join("bin")
                .join("feria-server.mjs");
            if candidate.is_file() {
                return Ok((
                    "node".to_string(),
                    vec![candidate.to_string_lossy().into_owned()],
                ));
            }
            cursor = dir.parent();
        }
    }

    Err("Could not find feria binary. Set LAMALIBRE_FERIA_BIN, install @lamalibre/feria-server globally, or check out the feria repo (https://github.com/lamalibre/feria) as a sibling of lamaste.".to_string())
}

/// Path for the managed feria's combined stdout+stderr log.
fn feria_log_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "feria: HOME env var not set".to_string())?;
    #[cfg(target_os = "macos")]
    let path = home
        .join("Library")
        .join("Caches")
        .join("lamaste-desktop")
        .join("feria.log");
    #[cfg(not(target_os = "macos"))]
    let path = home
        .join(".cache")
        .join("lamaste-desktop")
        .join("feria.log");
    Ok(path)
}

/// Read up to `max_bytes` from the tail of `path`.
fn read_log_tail(path: &Path, max_bytes: u64) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let size = file.metadata().ok()?.len();
    let start = size.saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::with_capacity((size - start) as usize);
    file.read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).trim().to_string())
}

/// Test whether the process represented by `child` has already exited.
fn child_exited(child: &mut Child) -> Option<std::process::ExitStatus> {
    match child.try_wait() {
        Ok(Some(status)) => Some(status),
        _ => None,
    }
}

/// Best-effort cleanup: if the managed child has died since we last
/// looked, forget about it.
fn reap_managed() {
    let mut guard = match managed().lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(child) = guard.as_mut() {
        if child_exited(child).is_some() {
            *guard = None;
        }
    }
}

/// Start a feria instance as a child process.
pub fn start_managed() -> Result<FeriaProcessStatus, String> {
    reap_managed();

    // Already running under our supervision — nothing to do.
    {
        let guard = managed()
            .lock()
            .map_err(|e| format!("feria: managed lock poisoned: {}", e))?;
        if guard.is_some() {
            drop(guard);
            return get_process_status();
        }
    }

    // Someone else is already serving 127.0.0.1:4873.
    if is_reachable() {
        return Err("Feria is already running externally on port 4873. Stop it first or leave it running — lamaste-desktop will talk to the existing instance.".to_string());
    }

    let (cmd, pre_args) = discover_feria_binary()?;

    let mut args = pre_args;
    args.push("start".to_string());
    args.push("--no-npmrc".to_string());

    let log_path = feria_log_path()?;
    if let Some(parent) = log_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("feria: failed to create log dir: {}", e))?;
    }
    let stdout_file = std::fs::File::create(&log_path)
        .map_err(|e| format!("feria: failed to open log file: {}", e))?;
    let stderr_file = stdout_file
        .try_clone()
        .map_err(|e| format!("feria: failed to clone log handle: {}", e))?;

    // Bind on all interfaces so E2E VMs can reach the registry through the
    // multipass host bridge.
    let child = Command::new(&cmd)
        .args(&args)
        .env("FERIA_HOST", "0.0.0.0")
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .spawn()
        .map_err(|e| format!("failed to spawn feria ({}): {}", cmd, e))?;

    let pid = child.id();
    {
        let mut guard = managed()
            .lock()
            .map_err(|e| format!("feria: managed lock poisoned: {}", e))?;
        *guard = Some(child);
    }

    // Poll for reachability so the UI can immediately flip to green.
    let deadline = Instant::now() + Duration::from_millis(START_READY_TIMEOUT_MS);
    while Instant::now() < deadline {
        if is_reachable() {
            return Ok(FeriaProcessStatus {
                state: "managed-running".to_string(),
                binary: Some(format_invocation(&cmd, &args)),
                pid: Some(pid),
                error: None,
                ownable: true,
            });
        }
        // Detect crash-on-start so we don't wait the full timeout.
        {
            let mut guard = managed()
                .lock()
                .map_err(|e| format!("feria: managed lock poisoned: {}", e))?;
            if let Some(child) = guard.as_mut() {
                if let Some(status) = child_exited(child) {
                    *guard = None;
                    drop(guard);
                    let tail = read_log_tail(&log_path, 2_000)
                        .unwrap_or_else(|| "(no log output captured)".to_string());
                    return Err(format!(
                        "feria exited during startup with status {}. Log:\n{}",
                        status, tail
                    ));
                }
            }
        }
        std::thread::sleep(Duration::from_millis(START_POLL_INTERVAL_MS));
    }

    // Timed out waiting for reachability.
    let _ = stop_managed();
    Err(format!(
        "feria did not become reachable within {} ms — check that port 4873 is free and node is on PATH",
        START_READY_TIMEOUT_MS
    ))
}

/// Look up the pid(s) listening on feria's TCP port via `lsof`.
fn pids_listening_on_feria_port() -> Vec<u32> {
    let out = match Command::new("lsof")
        .args(["-nP", "-iTCP:4873", "-sTCP:LISTEN", "-t"])
        .output()
    {
        Ok(out) if out.status.success() => out,
        _ => return Vec::new(),
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| l.trim().parse::<u32>().ok())
        .collect()
}

/// Kill an externally-running feria and start a managed replacement.
pub fn takeover_external() -> Result<FeriaProcessStatus, String> {
    reap_managed();

    // Already ours — nothing to do.
    {
        let guard = managed()
            .lock()
            .map_err(|e| format!("feria: managed lock poisoned: {}", e))?;
        if guard.is_some() {
            drop(guard);
            return get_process_status();
        }
    }

    if !is_reachable() {
        return start_managed();
    }

    let pids = pids_listening_on_feria_port();
    if pids.is_empty() {
        return Err("Feria reports reachable on :4873 but lsof could not identify the pid. Stop it manually from the terminal where you started it.".to_string());
    }

    // First pass: polite SIGTERM.
    for pid in &pids {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status();
    }

    // Wait up to 3 seconds for port to free.
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if !is_reachable() {
            break;
        }
        std::thread::sleep(Duration::from_millis(150));
    }

    // Still up? Escalate to SIGKILL.
    if is_reachable() {
        for pid in &pids {
            let _ = Command::new("kill")
                .args(["-KILL", &pid.to_string()])
                .status();
        }
        let deadline = Instant::now() + Duration::from_secs(1);
        while Instant::now() < deadline {
            if !is_reachable() {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    if is_reachable() {
        return Err(format!(
            "Could not free port 4873 after SIGTERM + SIGKILL to pid(s) {:?}",
            pids
        ));
    }

    start_managed()
}

/// Stop the managed feria child, if any. Externally-started instances are
/// left alone. Idempotent.
pub fn stop_managed() -> Result<FeriaProcessStatus, String> {
    {
        let mut guard = managed()
            .lock()
            .map_err(|e| format!("feria: managed lock poisoned: {}", e))?;
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    get_process_status()
}

/// Describe the current feria state for the UI.
pub fn get_process_status() -> Result<FeriaProcessStatus, String> {
    reap_managed();
    let (managed_alive, pid) = {
        let guard = managed()
            .lock()
            .map_err(|e| format!("feria: managed lock poisoned: {}", e))?;
        match guard.as_ref() {
            Some(child) => (true, Some(child.id())),
            None => (false, None),
        }
    };

    let reachable = is_reachable();
    let binary = discover_feria_binary()
        .ok()
        .map(|(c, a)| format_invocation(&c, &a));

    let state = match (managed_alive, reachable) {
        (true, true) => "managed-running",
        (true, false) => "starting",
        (false, true) => "external-running",
        (false, false) => "stopped",
    };

    Ok(FeriaProcessStatus {
        state: state.to_string(),
        binary,
        pid,
        error: None,
        ownable: managed_alive && reachable,
    })
}

fn format_invocation(cmd: &str, args: &[String]) -> String {
    if args.is_empty() {
        cmd.to_string()
    } else {
        format!("{} {}", cmd, args.join(" "))
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Tauri commands
// ─────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn feria_get_status() -> Result<FeriaProcessStatus, String> {
    tokio::task::spawn_blocking(get_process_status)
        .await
        .map_err(|e| format!("feria_get_status join error: {}", e))?
}

#[tauri::command]
pub async fn feria_start() -> Result<FeriaProcessStatus, String> {
    tokio::task::spawn_blocking(start_managed)
        .await
        .map_err(|e| format!("feria_start join error: {}", e))?
}

#[tauri::command]
pub async fn feria_stop() -> Result<FeriaProcessStatus, String> {
    tokio::task::spawn_blocking(stop_managed)
        .await
        .map_err(|e| format!("feria_stop join error: {}", e))?
}

#[tauri::command]
pub async fn feria_takeover() -> Result<FeriaProcessStatus, String> {
    tokio::task::spawn_blocking(takeover_external)
        .await
        .map_err(|e| format!("feria_takeover join error: {}", e))?
}
