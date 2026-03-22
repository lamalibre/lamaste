use crate::api::curl_panel;
use crate::config;
use serde::{Deserialize, Serialize};

// --- URL encoding helper ---

/// Percent-encode a string for safe use in URL path segments.
fn url_encode(s: &str) -> String {
    let mut encoded = String::with_capacity(s.len());
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(byte as char);
            }
            _ => {
                encoded.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    encoded
}

// --- Structs ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub name: String,
    pub package_name: String,
    pub version: String,
    pub description: Option<String>,
    pub status: String,
    pub capabilities: Option<Vec<String>>,
    pub installed_at: Option<String>,
    pub enabled_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginActionResult {
    pub ok: bool,
    pub name: String,
    pub status: Option<String>,
}

// --- API response wrappers ---

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginsResponse {
    plugins: Vec<PluginInfo>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallResponse {
    ok: bool,
    plugin: PluginInfo,
}

// --- Tauri commands ---

#[tauri::command]
pub async fn get_plugins() -> Result<Vec<PluginInfo>, String> {
    let cfg = config::load_config()?;
    let result = tokio::task::spawn_blocking(move || {
        curl_panel(&cfg, "GET", "/api/plugins", None)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;

    let body = result?;
    let data: PluginsResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse plugins: {} — body: {}", e, body))?;
    Ok(data.plugins)
}

#[tauri::command]
pub async fn install_plugin(package_name: String) -> Result<PluginInfo, String> {
    let cfg = config::load_config()?;
    let json_body = serde_json::json!({ "packageName": package_name }).to_string();

    let result = tokio::task::spawn_blocking(move || {
        curl_panel(&cfg, "POST", "/api/plugins/install", Some(&json_body))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;

    let body = result?;
    let data: InstallResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse install result: {} — body: {}", e, body))?;
    Ok(data.plugin)
}

#[tauri::command]
pub async fn enable_plugin(name: String) -> Result<PluginActionResult, String> {
    let cfg = config::load_config()?;
    let path = format!("/api/plugins/{}/enable", url_encode(&name));

    let result = tokio::task::spawn_blocking(move || {
        curl_panel(&cfg, "POST", &path, None)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;

    let body = result?;
    serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse enable result: {} — body: {}", e, body))
}

#[tauri::command]
pub async fn disable_plugin(name: String) -> Result<PluginActionResult, String> {
    let cfg = config::load_config()?;
    let path = format!("/api/plugins/{}/disable", url_encode(&name));

    let result = tokio::task::spawn_blocking(move || {
        curl_panel(&cfg, "POST", &path, None)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;

    let body = result?;
    serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse disable result: {} — body: {}", e, body))
}

#[tauri::command]
pub async fn uninstall_plugin(name: String) -> Result<String, String> {
    let cfg = config::load_config()?;
    let path = format!("/api/plugins/{}", url_encode(&name));

    let result = tokio::task::spawn_blocking(move || {
        curl_panel(&cfg, "DELETE", &path, None)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;

    result?;
    Ok(format!("Plugin {} uninstalled", name))
}
