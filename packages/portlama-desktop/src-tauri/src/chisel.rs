use std::path::Path;
use std::process::Command;

use crate::config;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChiselStatus {
    pub installed: bool,
    pub running: bool,
    pub pid: Option<u32>,
    pub version: Option<String>,
}

pub fn get_chisel_status() -> ChiselStatus {
    let bin = config::chisel_bin_path();
    let installed = bin.exists();

    let version = if installed {
        Command::new(&bin)
            .arg("--version")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|v| v.trim().to_string())
    } else {
        None
    };

    let (running, pid) = check_chisel_running();

    ChiselStatus {
        installed,
        running,
        pid,
        version,
    }
}

fn check_chisel_running() -> (bool, Option<u32>) {
    #[cfg(target_os = "macos")]
    {
        check_launchctl()
    }
    #[cfg(target_os = "linux")]
    {
        check_systemd_user()
    }
}

#[cfg(target_os = "macos")]
fn check_launchctl() -> (bool, Option<u32>) {
    let output = Command::new("launchctl")
        .args(["list", "com.portlama.chisel"])
        .output();

    match output {
        Ok(o) if o.status.success() => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            // launchctl list output: PID\tStatus\tLabel
            let pid = stdout
                .lines()
                .find(|l| l.contains("com.portlama.chisel"))
                .and_then(|l| l.split('\t').next())
                .and_then(|p| p.trim().parse::<u32>().ok());
            (true, pid)
        }
        _ => (false, None),
    }
}

#[cfg(target_os = "linux")]
fn check_systemd_user() -> (bool, Option<u32>) {
    let output = Command::new("systemctl")
        .args(["--user", "is-active", "portlama-chisel"])
        .output();

    let running = output
        .as_ref()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "active")
        .unwrap_or(false);

    let pid = if running {
        Command::new("systemctl")
            .args(["--user", "show", "portlama-chisel", "--property=MainPID"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| {
                s.trim()
                    .strip_prefix("MainPID=")
                    .and_then(|p| p.parse::<u32>().ok())
            })
            .filter(|&p| p > 0)
    } else {
        None
    };

    (running, pid)
}

pub fn read_log_tail(lines: usize) -> String {
    let log_path = config::log_file_path();
    read_tail(&log_path, lines)
}

pub fn read_error_log_tail(lines: usize) -> String {
    let log_path = config::error_log_path();
    read_tail(&log_path, lines)
}

fn read_tail(path: &Path, lines: usize) -> String {
    if !path.exists() {
        return String::new();
    }
    Command::new("tail")
        .args(["-n", &lines.to_string(), &path.to_string_lossy().to_string()])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .unwrap_or_default()
}
