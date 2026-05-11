use crate::config;
use crate::credentials;

pub(crate) const AGENTD_PORT: u16 = 9393;

/// Curl the local agentd service (plain HTTP on 127.0.0.1:9393).
///
/// Authenticates with the per-user Bearer token at `~/.lamalibre/lamaste/agentd.token`
/// (mode 0600) — only the agent's owning OS user can read it.
pub(crate) fn curl_agentd(
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<String, String> {
    let url = format!("http://127.0.0.1:{}{}", AGENTD_PORT, path);
    let token = crate::api::agentd_token()?;

    let mut args = vec![
        "-s".to_string(),
        "-H".to_string(),
        format!("Authorization: Bearer {}", token),
        "-X".to_string(),
        method.to_string(),
    ];

    if let Some(json_body) = body {
        args.push("-H".to_string());
        args.push("Content-Type: application/json".to_string());
        args.push("-d".to_string());
        args.push(json_body.to_string());
    }

    args.push(url);

    let output = std::process::Command::new("curl")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run curl: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Request failed: {}", stderr));
    }

    let body = String::from_utf8_lossy(&output.stdout).to_string();

    if let Ok(err_obj) = serde_json::from_str::<serde_json::Value>(&body) {
        if let Some(error) = err_obj.get("error").and_then(|e| e.as_str()) {
            return Err(error.to_string());
        }
    }

    Ok(body)
}

/// Set the active mode for a server ("agent" or "admin").
#[tauri::command]
pub async fn set_server_mode(_server_id: String, mode: String) -> Result<(), String> {
    if mode != "agent" && mode != "admin" {
        return Err("Mode must be 'agent' or 'admin'".to_string());
    }

    tokio::task::spawn_blocking(move || {
        let payload = serde_json::json!({ "mode": mode });
        curl_agentd("PATCH", "/api/mode", Some(&payload.to_string()))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Get the active server's mode.
#[tauri::command]
pub async fn get_server_mode() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let body = curl_agentd("GET", "/api/mode", None)?;
        let parsed: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse mode response: {}", e))?;
        parsed
            .get("mode")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| "Missing 'mode' in response".to_string())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Check if the active server has an admin certificate.
#[tauri::command]
pub async fn has_admin_cert() -> Result<bool, String> {
    tokio::task::spawn_blocking(|| {
        let body = curl_agentd("GET", "/api/admin-cert", None)?;
        let parsed: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse admin-cert response: {}", e))?;
        parsed
            .get("hasAdminCert")
            .and_then(|v| v.as_bool())
            .ok_or_else(|| "Missing 'hasAdminCert' in response".to_string())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Import an admin P12 certificate for a server.
#[tauri::command]
pub async fn import_admin_cert(
    server_id: String,
    p12_path: String,
    p12_password: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        // Validate server_id is safe for filesystem paths
        if server_id.contains('/') || server_id.contains('\\') || server_id.contains('\0') || server_id.contains("..") {
            return Err("Server ID contains invalid characters".to_string());
        }

        // Validate the source P12 file exists and is a regular file
        let src = std::path::Path::new(&p12_path);
        let metadata = src.symlink_metadata()
            .map_err(|_| "P12 file not found".to_string())?;
        if !metadata.is_file() {
            return Err("P12 path must be a regular file".to_string());
        }

        // Create server directory if needed
        let server_dir = config::agent_dir().join("servers").join(&server_id);
        std::fs::create_dir_all(&server_dir)
            .map_err(|e| format!("Failed to create server directory: {}", e))?;

        // Copy P12 to admin.p12
        let dest = server_dir.join("admin.p12");
        std::fs::copy(src, &dest)
            .map_err(|e| format!("Failed to copy P12: {}", e))?;

        // Set restrictive permissions
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o600))
                .map_err(|e| format!("Failed to set permissions: {}", e))?;
        }

        // Store password in credential store (must stay in Rust — OS keychain)
        credentials::store_admin_credential(&server_id, &p12_password)?;

        // Update servers.json via agentd REST API
        let payload = serde_json::json!({
            "adminAuth": {
                "method": "p12",
                "p12Path": dest.to_string_lossy()
            }
        });
        let path = format!("/api/servers/{}", server_id);
        curl_agentd("PATCH", &path, Some(&payload.to_string()))?;

        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Remove the admin certificate for a server.
#[tauri::command]
pub async fn remove_admin_cert(server_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        // Validate server_id is safe for filesystem paths
        if server_id.contains('/') || server_id.contains('\\') || server_id.contains('\0') || server_id.contains("..") {
            return Err("Server ID contains invalid characters".to_string());
        }

        // Delete admin P12 file
        let admin_p12 = config::agent_dir().join("servers").join(&server_id).join("admin.p12");
        if admin_p12.exists() {
            std::fs::remove_file(&admin_p12)
                .map_err(|e| format!("Failed to remove admin P12: {}", e))?;
        }

        // Delete credential (must stay in Rust — OS keychain)
        let _ = credentials::delete_admin_credential(&server_id);

        // Remove adminAuth and reset mode via agentd REST API
        // Use null to remove the adminAuth field, and reset mode to agent
        let payload = serde_json::json!({
            "adminAuth": null,
            "activeMode": "agent"
        });
        let path = format!("/api/servers/{}", server_id);
        curl_agentd("PATCH", &path, Some(&payload.to_string()))?;

        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}
