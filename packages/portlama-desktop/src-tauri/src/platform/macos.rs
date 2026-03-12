use std::path::PathBuf;

pub fn plist_path() -> PathBuf {
    dirs::home_dir()
        .expect("No home directory")
        .join("Library/LaunchAgents/com.portlama.chisel.plist")
}

pub fn is_agent_loaded() -> bool {
    std::process::Command::new("launchctl")
        .args(["list", "com.portlama.chisel"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
