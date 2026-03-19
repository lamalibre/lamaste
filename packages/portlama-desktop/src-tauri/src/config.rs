use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub panel_url: String,
    pub p12_path: String,
    pub p12_password: String,
    pub domain: Option<String>,
    pub chisel_version: Option<String>,
    pub setup_at: Option<String>,
    pub updated_at: Option<String>,
}

pub fn agent_dir() -> PathBuf {
    dirs::home_dir()
        .expect("Could not determine home directory")
        .join(".portlama")
}

pub fn config_path() -> PathBuf {
    agent_dir().join("agent.json")
}

pub fn chisel_bin_path() -> PathBuf {
    agent_dir().join("bin").join("chisel")
}

pub fn log_file_path() -> PathBuf {
    agent_dir().join("logs").join("chisel.log")
}

pub fn error_log_path() -> PathBuf {
    agent_dir().join("logs").join("chisel.error.log")
}

pub fn services_registry_path() -> PathBuf {
    agent_dir().join("services.json")
}

pub fn plist_path() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir()
            .expect("Could not determine home directory")
            .join("Library/LaunchAgents/com.portlama.chisel.plist")
    }
    #[cfg(target_os = "linux")]
    {
        dirs::home_dir()
            .expect("Could not determine home directory")
            .join(".config/systemd/user/portlama-chisel.service")
    }
}

pub fn load_config() -> Result<AgentConfig, String> {
    let path = config_path();
    if !path.exists() {
        return Err("not_configured".to_string());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))
}

pub fn save_config(config: &AgentConfig) -> Result<(), String> {
    let path = config_path();
    let dir = path.parent().unwrap();
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;

    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, &json)
        .map_err(|e| format!("Failed to write temp config: {}", e))?;

    // Set restrictive permissions before rename
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Failed to set config permissions: {}", e))?;
    }

    std::fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to save config: {}", e))?;

    Ok(())
}
