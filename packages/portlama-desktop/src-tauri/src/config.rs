use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub panel_url: String,
    /// Authentication method: "p12" (default) or "keychain"
    #[serde(default = "default_auth_method")]
    pub auth_method: String,
    /// Path to P12 file (used when auth_method is "p12")
    #[serde(default)]
    pub p12_path: Option<String>,
    /// P12 password (used when auth_method is "p12").
    /// skip_serializing: password should be in the OS credential store, not JSON.
    #[serde(default, skip_serializing)]
    pub p12_password: Option<String>,
    /// Keychain identity name (used when auth_method is "keychain")
    #[serde(default)]
    pub keychain_identity: Option<String>,
    /// Agent label (used when auth_method is "keychain")
    #[serde(default)]
    pub agent_label: Option<String>,
    pub domain: Option<String>,
    pub chisel_version: Option<String>,
    pub setup_at: Option<String>,
    pub updated_at: Option<String>,
}

/// Admin certificate authentication details.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminAuth {
    /// Authentication method: "p12" or "keychain"
    #[serde(default = "default_auth_method")]
    pub method: String,
    /// Path to admin P12 file
    #[serde(default)]
    pub p12_path: Option<String>,
    /// Keychain identity for admin cert (macOS)
    #[serde(default)]
    pub keychain_identity: Option<String>,
}

fn default_auth_method() -> String {
    "p12".to_string()
}

fn default_mode() -> String {
    "agent".to_string()
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

pub fn servers_registry_path() -> PathBuf {
    agent_dir().join("servers.json")
}

/// Minimal typed struct for entries in `servers.json`.
/// Only the fields needed for `load_effective_config`; unknown fields are ignored.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerRegistryEntry {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    active: bool,
    panel_url: String,
    #[serde(default = "default_auth_method")]
    auth_method: String,
    #[serde(default)]
    p12_path: Option<String>,
    #[serde(default)]
    p12_password: Option<String>,
    #[serde(default)]
    keychain_identity: Option<String>,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    admin_auth: Option<AdminAuth>,
    #[serde(default = "default_mode")]
    active_mode: String,
}

/// Load the effective agent configuration.
///
/// Priority: agents.json (multi-agent) → servers.json (server mode) → agent.json (legacy).
pub fn load_effective_config() -> Result<AgentConfig, String> {
    // 1. Check agents.json (multi-agent registry)
    if let Ok(Some(registry)) = crate::agents::load_agents_registry() {
        // Find the current agent, or fall back to first
        let agent = if let Some(ref label) = registry.current_label {
            registry.agents.iter().find(|a| &a.label == label)
        } else {
            None
        }
        .or_else(|| registry.agents.first());

        if let Some(entry) = agent {
            return Ok(crate::agents::agent_entry_to_config(entry));
        }
    }

    // 2. Check servers.json
    let registry_path = servers_registry_path();
    if registry_path.exists() {
        let content = std::fs::read_to_string(&registry_path)
            .map_err(|e| format!("Failed to read servers.json: {}", e))?;
        let servers: Vec<ServerRegistryEntry> = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse servers.json: {}", e))?;

        if let Some(active) = servers.iter().find(|s| s.active) {
            // If p12_password is not in the JSON (migrated to credential store),
            // retrieve it using the server ID.
            let mut p12_password = active.p12_password.clone();
            if p12_password.is_none() && active.auth_method == "p12" {
                if let Some(ref id) = active.id {
                    if let Ok(Some(pw)) = crate::credentials::get_server_credential(id) {
                        p12_password = Some(pw);
                    }
                }
            }
            return Ok(AgentConfig {
                panel_url: active.panel_url.clone(),
                auth_method: active.auth_method.clone(),
                p12_path: active.p12_path.clone(),
                p12_password,
                keychain_identity: active.keychain_identity.clone(),
                agent_label: None,
                domain: active.label.clone(),
                chisel_version: None,
                setup_at: active.created_at.clone(),
                updated_at: None,
            });
        }
    }

    // Fall back to agent.json
    load_config()
}

/// Admin API configuration — used by admin commands.
pub struct AdminApiConfig {
    pub panel_url: String,
    pub auth_method: String,
    pub p12_path: Option<String>,
    pub p12_password: Option<String>,
    pub keychain_identity: Option<String>,
}

/// Load the admin configuration for the active server.
/// If the server has explicit admin_auth, use that.
/// Otherwise, fall back to the top-level auth (for cloud-provisioned servers
/// where the primary cert IS the admin cert).
pub fn load_admin_config() -> Result<AdminApiConfig, String> {
    let registry_path = servers_registry_path();
    if !registry_path.exists() {
        return Err("No servers configured".to_string());
    }

    let content = std::fs::read_to_string(&registry_path)
        .map_err(|e| format!("Failed to read servers.json: {}", e))?;
    let servers: Vec<serde_json::Value> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse servers.json: {}", e))?;

    let active = servers.iter().find(|s| s.get("active").and_then(|v| v.as_bool()).unwrap_or(false))
        .ok_or("No active server")?;

    let server_id = active.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let panel_url = active.get("panelUrl").and_then(|v| v.as_str())
        .ok_or("Active server has no panelUrl")?.to_string();

    // Check for explicit admin_auth
    if let Some(admin_auth) = active.get("adminAuth") {
        let method = admin_auth.get("method").and_then(|v| v.as_str()).unwrap_or("p12").to_string();
        let p12_path = admin_auth.get("p12Path").and_then(|v| v.as_str()).map(String::from);
        let keychain_identity = admin_auth.get("keychainIdentity").and_then(|v| v.as_str()).map(String::from);

        let mut p12_password = None;
        if method == "p12" {
            if let Ok(Some(pw)) = crate::credentials::get_admin_credential(server_id) {
                p12_password = Some(pw);
            }
        }

        return Ok(AdminApiConfig {
            panel_url,
            auth_method: method,
            p12_path,
            p12_password,
            keychain_identity,
        });
    }

    // Fall back to top-level auth (cloud-provisioned servers)
    let auth_method = active.get("authMethod").and_then(|v| v.as_str()).unwrap_or("p12").to_string();
    let p12_path = active.get("p12Path").and_then(|v| v.as_str()).map(String::from);
    let keychain_identity = active.get("keychainIdentity").and_then(|v| v.as_str()).map(String::from);

    let mut p12_password = None;
    if auth_method == "p12" {
        if let Ok(Some(pw)) = crate::credentials::get_server_credential(server_id) {
            p12_password = Some(pw);
        }
    }

    Ok(AdminApiConfig {
        panel_url,
        auth_method,
        p12_path,
        p12_password,
        keychain_identity,
    })
}

/// Get the active server's mode ("agent" or "admin").
pub fn get_active_mode() -> Result<String, String> {
    let registry_path = servers_registry_path();
    if !registry_path.exists() {
        return Ok("agent".to_string());
    }
    let content = std::fs::read_to_string(&registry_path)
        .map_err(|e| format!("Failed to read servers.json: {}", e))?;
    let servers: Vec<ServerRegistryEntry> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse servers.json: {}", e))?;

    if let Some(active) = servers.iter().find(|s| s.active) {
        Ok(active.active_mode.clone())
    } else {
        Ok("agent".to_string())
    }
}

/// Check if the active server has an admin certificate configured.
pub fn has_admin_cert() -> Result<bool, String> {
    let registry_path = servers_registry_path();
    if !registry_path.exists() {
        return Ok(false);
    }
    let content = std::fs::read_to_string(&registry_path)
        .map_err(|e| format!("Failed to read servers.json: {}", e))?;
    let servers: Vec<serde_json::Value> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse servers.json: {}", e))?;

    let active = servers.iter().find(|s| s.get("active").and_then(|v| v.as_bool()).unwrap_or(false));
    if let Some(server) = active {
        // Has explicit admin_auth
        if server.get("adminAuth").is_some() {
            return Ok(true);
        }
        // Cloud-provisioned servers (have provider field) use admin cert as primary
        if server.get("provider").is_some() {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Get the active server's ID.
pub fn get_active_server_id() -> Result<String, String> {
    let registry_path = servers_registry_path();
    if !registry_path.exists() {
        return Err("No servers configured".to_string());
    }
    let content = std::fs::read_to_string(&registry_path)
        .map_err(|e| format!("Failed to read servers.json: {}", e))?;
    let servers: Vec<serde_json::Value> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse servers.json: {}", e))?;

    let active = servers.iter().find(|s| s.get("active").and_then(|v| v.as_bool()).unwrap_or(false))
        .ok_or("No active server")?;
    active.get("id").and_then(|v| v.as_str()).map(String::from)
        .ok_or("Active server has no ID".to_string())
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

    {
        let mut file = std::fs::File::create(&tmp_path)
            .map_err(|e| format!("Failed to create temp config: {}", e))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("Failed to write temp config: {}", e))?;
        file.sync_all()
            .map_err(|e| format!("Failed to fsync temp config: {}", e))?;
    }

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
