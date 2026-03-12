use std::path::PathBuf;

pub fn service_unit_path() -> PathBuf {
    dirs::home_dir()
        .expect("No home directory")
        .join(".config/systemd/user/portlama-chisel.service")
}

pub fn is_agent_active() -> bool {
    std::process::Command::new("systemctl")
        .args(["--user", "is-active", "portlama-chisel"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "active")
        .unwrap_or(false)
}
