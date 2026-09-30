//! The user's login-shell PATH.
//!
//! An app started from Finder, the Dock or a desktop launcher inherits the
//! session's minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin` on macOS), not the
//! one the user's shell builds. `node`, `npm` and globally installed CLIs
//! live in Homebrew, nvm, volta or `~/.local/bin`, so every one of them would
//! fail to spawn. Started from a terminal the app already has that PATH, and
//! adopting it again changes nothing.

#[cfg(unix)]
use std::io::Read;
#[cfg(unix)]
use std::process::{Command, Stdio};
#[cfg(unix)]
use std::time::{Duration, Instant};

#[cfg(unix)]
const MARKER: &str = "__LAMASTE_PATH__";
#[cfg(unix)]
const SHELL_TIMEOUT: Duration = Duration::from_secs(5);

/// Ask the login shell for its PATH, bounded by [`SHELL_TIMEOUT`] so a shell
/// profile that blocks cannot keep the app from starting.
#[cfg(unix)]
fn login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| std::path::Path::new(s).is_absolute())
        .unwrap_or_else(|| "/bin/sh".to_string());

    // -i as well as -l: version managers (nvm, fnm) are usually set up in the
    // interactive rc file. The markers cut the value out of whatever else the
    // profile prints.
    let mut child = Command::new(&shell)
        .args(["-ilc", &format!("printf '{MARKER}%s{MARKER}' \"$PATH\"")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let deadline = Instant::now() + SHELL_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(25));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }

    let mut stdout = String::new();
    child.stdout.take()?.read_to_string(&mut stdout).ok()?;
    let start = stdout.find(MARKER)? + MARKER.len();
    let end = stdout[start..].find(MARKER)? + start;
    let path = stdout[start..end].trim();
    (!path.is_empty()).then(|| path.to_string())
}

/// Put the login shell's PATH in front of the inherited one.
///
/// Must run before any thread is started: it changes the process environment.
#[cfg(unix)]
pub fn adopt_login_shell_path() {
    let Some(shell_path) = login_shell_path() else {
        return;
    };
    let inherited = std::env::var("PATH").unwrap_or_default();
    let mut entries: Vec<&str> = Vec::new();
    for entry in shell_path.split(':').chain(inherited.split(':')) {
        if !entry.is_empty() && !entries.contains(&entry) {
            entries.push(entry);
        }
    }
    std::env::set_var("PATH", entries.join(":"));
}

#[cfg(not(unix))]
pub fn adopt_login_shell_path() {}
