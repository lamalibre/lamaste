use crate::branding::{user_ecosystem_root, user_product_root, ORG, PROJECT};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// Branded identifiers — single source of truth lives in `branding.rs`.
// ---------------------------------------------------------------------------
//
// Defaults are (~/.lamalibre/lamaste/, com.lamalibre.lamaste.*,
// lamalibre-lamaste-*). The v3 rebrand from "lamaste" to "lamaste" is
// therefore a single-line default change in `branding.rs`.

/// Organization identifier — the company. Will not change.
pub fn org() -> String {
    ORG.to_string()
}

/// Project identifier — becomes "lamaste" at v3.
pub fn project() -> String {
    PROJECT.to_string()
}

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

pub fn agent_dir() -> PathBuf {
    user_product_root().expect("Could not determine home directory")
}

pub fn config_path() -> PathBuf {
    agent_dir().join("agent.json")
}

pub fn servers_registry_path() -> PathBuf {
    agent_dir().join("servers.json")
}

pub fn storage_servers_registry_path() -> PathBuf {
    agent_dir().join("storage-servers.json")
}

/// Local plugin host directory — hoisted to the ecosystem root because the
/// host is product-agnostic. Mirrors LOCAL_DIR in @lamalibre/lamaste/agent.
pub fn local_dir() -> PathBuf {
    user_ecosystem_root()
        .expect("Could not determine home directory")
        .join("local")
}

pub fn local_plugins_dir() -> PathBuf {
    local_dir().join("plugins")
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

    admin_config_from_server(active)
}

/// Build AdminApiConfig from a raw serde_json::Value server entry.
fn admin_config_from_server(server: &serde_json::Value) -> Result<AdminApiConfig, String> {
    let server_id = server.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let panel_url = server.get("panelUrl").and_then(|v| v.as_str())
        .ok_or("Server has no panelUrl")?.to_string();

    // Check for explicit admin_auth
    if let Some(admin_auth) = server.get("adminAuth") {
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
    let auth_method = server.get("authMethod").and_then(|v| v.as_str()).unwrap_or("p12").to_string();
    let p12_path = server.get("p12Path").and_then(|v| v.as_str()).map(String::from);
    let keychain_identity = server.get("keychainIdentity").and_then(|v| v.as_str()).map(String::from);

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

/// Load the admin configuration for a server identified by label.
pub fn load_admin_config_for_label(label: &str) -> Result<AdminApiConfig, String> {
    let registry_path = servers_registry_path();
    if !registry_path.exists() {
        return Err("No servers configured".to_string());
    }

    let content = std::fs::read_to_string(&registry_path)
        .map_err(|e| format!("Failed to read servers.json: {}", e))?;
    let servers: Vec<serde_json::Value> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse servers.json: {}", e))?;

    let server = servers.iter()
        .find(|s| s.get("label").and_then(|v| v.as_str()) == Some(label))
        .ok_or_else(|| format!("No server with label \"{}\"", label))?;

    admin_config_from_server(server)
}

/// Load the admin configuration for a specific server by ID.
pub fn load_admin_config_for_server_id(server_id: &str) -> Result<AdminApiConfig, String> {
    let registry_path = servers_registry_path();
    if !registry_path.exists() {
        return Err("No servers configured".to_string());
    }

    let content = std::fs::read_to_string(&registry_path)
        .map_err(|e| format!("Failed to read servers.json: {}", e))?;
    let servers: Vec<serde_json::Value> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse servers.json: {}", e))?;

    let server = servers.iter()
        .find(|s| s.get("id").and_then(|v| v.as_str()) == Some(server_id))
        .ok_or_else(|| format!("No server with ID \"{}\"", server_id))?;

    admin_config_from_server(server)
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
