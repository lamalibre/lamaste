use crate::api::{curl_panel, curl_panel_binary};
use crate::chisel;
use crate::config;

// --- Status ---

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub configured: bool,
    pub chisel: chisel::ChiselStatus,
    pub config_error: Option<String>,
    pub setup_message: Option<String>,
}

#[tauri::command]
pub fn get_status() -> AppStatus {
    let config_result = config::load_config();
    let configured = config_result.is_ok();
    let chisel_status = chisel::get_chisel_status();

    let setup_message = if !configured {
        Some("Agent not configured. Run: npx @lamalibre/portlama-agent setup".to_string())
    } else {
        None
    };

    let config_error = match &config_result {
        Err(e) if e != "not_configured" => Some(e.clone()),
        _ => None,
    };

    AppStatus {
        configured,
        chisel: chisel_status,
        config_error,
        setup_message,
    }
}

#[tauri::command]
pub fn get_config() -> Result<config::AgentConfig, String> {
    config::load_config()
}

// --- Tunnels ---

#[derive(serde::Serialize, serde::Deserialize)]
pub struct TunnelInfo {
    pub id: Option<String>,
    pub subdomain: Option<String>,
    pub port: Option<u32>,
    pub fqdn: Option<String>,
    pub description: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(serde::Deserialize)]
struct TunnelsResponse {
    tunnels: Vec<TunnelInfo>,
}

#[tauri::command]
pub async fn get_tunnels() -> Result<Vec<TunnelInfo>, String> {
    let cfg = config::load_config()?;
    let body = curl_panel(&cfg, "GET", "/api/tunnels", None)?;
    let data: TunnelsResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse tunnels: {} — body: {}", e, body))?;
    Ok(data.tunnels)
}

#[tauri::command]
pub async fn create_tunnel(
    subdomain: String,
    port: u32,
    description: String,
) -> Result<TunnelInfo, String> {
    let cfg = config::load_config()?;
    let json_body = serde_json::json!({
        "subdomain": subdomain,
        "port": port,
        "description": description,
    })
    .to_string();

    let body = curl_panel(&cfg, "POST", "/api/tunnels", Some(&json_body))?;

    #[derive(serde::Deserialize)]
    struct CreateResponse {
        tunnel: TunnelInfo,
    }

    let data: CreateResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse create response: {}", e))?;
    Ok(data.tunnel)
}

#[tauri::command]
pub async fn toggle_tunnel(id: String, enabled: bool) -> Result<String, String> {
    let cfg = config::load_config()?;
    let json_body = serde_json::json!({ "enabled": enabled }).to_string();
    let path = format!("/api/tunnels/{}", id);
    curl_panel(&cfg, "PATCH", &path, Some(&json_body))?;
    Ok(if enabled { "Tunnel enabled".to_string() } else { "Tunnel disabled".to_string() })
}

#[tauri::command]
pub async fn delete_tunnel(id: String) -> Result<String, String> {
    let cfg = config::load_config()?;
    let path = format!("/api/tunnels/{}", id);
    curl_panel(&cfg, "DELETE", &path, None)?;
    Ok("Tunnel deleted".to_string())
}

// --- Chisel lifecycle ---

#[tauri::command]
pub fn stop_chisel() -> Result<String, String> {
    let path = config::plist_path();

    #[cfg(target_os = "macos")]
    {
        if !path.exists() {
            return Err("Plist not found. Run portlama-agent setup first.".to_string());
        }
        std::process::Command::new("launchctl")
            .args(["unload", &path.to_string_lossy()])
            .output()
            .map_err(|e| format!("Failed to stop: {}", e))?;
        Ok("Chisel stopped".to_string())
    }

    #[cfg(target_os = "linux")]
    {
        let _ = path; // suppress unused warning
        std::process::Command::new("systemctl")
            .args(["--user", "stop", "portlama-chisel"])
            .output()
            .map_err(|e| format!("Failed to stop: {}", e))?;
        Ok("Chisel stopped".to_string())
    }
}

#[tauri::command]
pub fn start_chisel() -> Result<String, String> {
    let path = config::plist_path();

    #[cfg(target_os = "macos")]
    {
        if !path.exists() {
            return Err("Plist not found. Run portlama-agent setup first.".to_string());
        }
        std::process::Command::new("launchctl")
            .args(["load", &path.to_string_lossy()])
            .output()
            .map_err(|e| format!("Failed to start: {}", e))?;
        Ok("Chisel started".to_string())
    }

    #[cfg(target_os = "linux")]
    {
        let _ = path;
        std::process::Command::new("systemctl")
            .args(["--user", "start", "portlama-chisel"])
            .output()
            .map_err(|e| format!("Failed to start: {}", e))?;
        Ok("Chisel started".to_string())
    }
}

#[tauri::command]
pub fn restart_chisel() -> Result<String, String> {
    let path = config::plist_path();

    #[cfg(target_os = "macos")]
    {
        if !path.exists() {
            return Err("Plist not found. Run portlama-agent setup first.".to_string());
        }
        let _ = std::process::Command::new("launchctl")
            .args(["unload", &path.to_string_lossy()])
            .output();
        std::process::Command::new("launchctl")
            .args(["load", &path.to_string_lossy()])
            .output()
            .map_err(|e| format!("Failed to reload: {}", e))?;
        Ok("Chisel restarted".to_string())
    }

    #[cfg(target_os = "linux")]
    {
        let _ = path;
        std::process::Command::new("systemctl")
            .args(["--user", "restart", "portlama-chisel"])
            .output()
            .map_err(|e| format!("Failed to restart: {}", e))?;
        Ok("Chisel restarted".to_string())
    }
}

// --- Agent management ---

#[tauri::command]
pub async fn update_agent() -> Result<String, String> {
    let mut cfg = config::load_config()?;

    // 1. Fetch plist from panel
    let body = curl_panel(&cfg, "GET", "/api/tunnels/mac-plist?format=json", None)?;

    #[derive(serde::Deserialize)]
    struct PlistResponse {
        plist: String,
    }

    let data: PlistResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse plist response: {}", e))?;

    // 2. Rewrite paths (same replacements as CLI agent)
    let chisel_bin = config::chisel_bin_path();
    let log_file = config::log_file_path();
    let error_log = config::error_log_path();

    let rewritten = data.plist
        .replace("/usr/local/bin/chisel", &chisel_bin.to_string_lossy())
        .replace("/usr/local/var/log/chisel.error.log", &error_log.to_string_lossy())
        .replace("/usr/local/var/log/chisel.log", &log_file.to_string_lossy());

    // 3. Write plist atomically
    let plist_path = config::plist_path();
    if let Some(parent) = plist_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create plist directory: {}", e))?;
    }
    let tmp_path = plist_path.with_extension("plist.tmp");
    std::fs::write(&tmp_path, &rewritten)
        .map_err(|e| format!("Failed to write plist: {}", e))?;
    std::fs::rename(&tmp_path, &plist_path)
        .map_err(|e| format!("Failed to save plist: {}", e))?;

    // 4. Reload agent
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("launchctl")
            .args(["unload", &plist_path.to_string_lossy()])
            .output();
        std::process::Command::new("launchctl")
            .args(["load", &plist_path.to_string_lossy()])
            .output()
            .map_err(|e| format!("Failed to reload agent: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("systemctl")
            .args(["--user", "restart", "portlama-chisel"])
            .output()
            .map_err(|e| format!("Failed to restart agent: {}", e))?;
    }

    // 5. Update config timestamp
    cfg.updated_at = Some(chrono::Utc::now().to_rfc3339());
    config::save_config(&cfg)?;

    Ok("Agent updated successfully".to_string())
}

#[tauri::command]
pub async fn uninstall_agent() -> Result<String, String> {
    let plist_path = config::plist_path();

    // 1. Unload agent (ignore errors — may not be loaded)
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("launchctl")
            .args(["unload", &plist_path.to_string_lossy()])
            .output();
    }

    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("systemctl")
            .args(["--user", "stop", "portlama-chisel"])
            .output();
    }

    // 2. Remove plist/service file
    if plist_path.exists() {
        std::fs::remove_file(&plist_path)
            .map_err(|e| format!("Failed to remove plist: {}", e))?;
    }

    // 3. Remove ~/.portlama directory (with symlink attack protection)
    let agent_dir = config::agent_dir();
    if agent_dir.exists() {
        let canonical = agent_dir.canonicalize()
            .map_err(|e| format!("Failed to resolve agent directory: {}", e))?;
        let home = dirs::home_dir().ok_or("Could not determine home directory")?;
        let expected = home.join(".portlama");
        if canonical != expected {
            return Err(format!(
                "Agent directory resolves to unexpected path: {:?}", canonical
            ));
        }
        std::fs::remove_dir_all(&canonical)
            .map_err(|e| format!("Failed to remove agent directory: {}", e))?;
    }

    Ok("Agent uninstalled".to_string())
}

// --- Certificate management ---

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RotateResult {
    pub expires_at: Option<String>,
    pub warning: Option<String>,
}

#[tauri::command]
pub async fn rotate_certificate() -> Result<RotateResult, String> {
    let mut cfg = config::load_config()?;

    // Certificate rotation only applies to P12-based agents
    if cfg.auth_method == "keychain" {
        return Err("Certificate rotation is not supported for hardware-bound (Keychain) certificates. \
            Re-run enrollment with a new token to rotate.".to_string());
    }

    // 1. Rotate certificate on server
    let body = curl_panel(&cfg, "POST", "/api/certs/mtls/rotate", None)?;

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RotateResponse {
        expires_at: Option<String>,
        warning: Option<String>,
    }

    let rotate_data: RotateResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse rotate response: {}", e))?;

    // 2. Download the new p12 certificate
    let p12_dest = config::agent_dir().join("client.p12");
    let tmp_path = p12_dest.with_extension("p12.tmp");

    curl_panel_binary(&cfg, "/api/certs/mtls/download", &tmp_path)?;

    // Set restrictive permissions immediately after download, before any other checks
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o600));
    }

    // Verify download produced a file with content
    let meta = std::fs::metadata(&tmp_path)
        .map_err(|e| format!("Downloaded p12 not found: {}", e))?;
    if meta.len() == 0 {
        let _ = std::fs::remove_file(&tmp_path);
        return Err("Downloaded certificate file is empty".to_string());
    }

    std::fs::rename(&tmp_path, &p12_dest)
        .map_err(|e| format!("Failed to save certificate: {}", e))?;

    // 3. Update config to point to the new p12
    cfg.p12_path = Some(p12_dest.to_string_lossy().to_string());
    config::save_config(&cfg)?;

    Ok(RotateResult {
        expires_at: rotate_data.expires_at,
        warning: rotate_data.warning,
    })
}

#[tauri::command]
pub async fn download_certificate() -> Result<String, String> {
    let mut cfg = config::load_config()?;

    if cfg.auth_method == "keychain" {
        return Err("Certificate download is not supported for hardware-bound (Keychain) certificates.".to_string());
    }

    let p12_dest = config::agent_dir().join("client.p12");
    let tmp_path = p12_dest.with_extension("p12.tmp");

    curl_panel_binary(&cfg, "/api/certs/mtls/download", &tmp_path)?;

    // Set restrictive permissions immediately after download, before any other checks
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o600));
    }

    let meta = std::fs::metadata(&tmp_path)
        .map_err(|e| format!("Downloaded p12 not found: {}", e))?;
    if meta.len() == 0 {
        let _ = std::fs::remove_file(&tmp_path);
        return Err("Downloaded certificate file is empty".to_string());
    }

    std::fs::rename(&tmp_path, &p12_dest)
        .map_err(|e| format!("Failed to save certificate: {}", e))?;

    // Update config to point to the new p12 path
    cfg.p12_path = Some(p12_dest.to_string_lossy().to_string());
    config::save_config(&cfg)?;

    Ok(p12_dest.to_string_lossy().to_string())
}

// --- Panel URL ---

#[tauri::command]
pub fn get_panel_url() -> Result<String, String> {
    let cfg = config::load_config()?;
    Ok(cfg.panel_url)
}

// --- Logs ---

#[tauri::command]
pub fn get_logs() -> Result<String, String> {
    let stdout_log = chisel::read_log_tail(100);
    let stderr_log = chisel::read_error_log_tail(100);

    let mut combined = String::new();
    if !stderr_log.is_empty() {
        combined.push_str(&stderr_log);
    }
    if !stdout_log.is_empty() {
        if !combined.is_empty() {
            combined.push('\n');
        }
        combined.push_str(&stdout_log);
    }

    Ok(combined)
}
