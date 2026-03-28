use crate::api;
use crate::config;
use crate::plugins::url_encode;
use tauri::{Emitter, Manager};

/// Truncate a response body for safe inclusion in error messages.
fn safe_error_body(body: &str) -> String {
    if body.len() <= 200 {
        body.to_string()
    } else {
        // Find last valid char boundary at or before byte 200
        let end = body.char_indices()
            .take_while(|(i, _)| *i < 200)
            .last()
            .map(|(i, c)| i + c.len_utf8())
            .unwrap_or(0);
        format!("{}...(truncated)", &body[..end])
    }
}

/// Helper: load admin config and make a GET request.
fn admin_get(path: &str) -> Result<serde_json::Value, String> {
    let cfg = config::load_admin_config()?;
    let body = api::curl_panel_admin(&cfg, "GET", path, None)?;
    serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse response: {} — body: {}", e, safe_error_body(&body)))
}

/// Helper: load admin config and make a POST request with JSON body.
fn admin_post(path: &str, body: Option<&str>) -> Result<serde_json::Value, String> {
    let cfg = config::load_admin_config()?;
    let resp = api::curl_panel_admin(&cfg, "POST", path, body)?;
    serde_json::from_str(&resp)
        .map_err(|e| format!("Failed to parse response: {} — body: {}", e, safe_error_body(&resp)))
}

/// Helper: load admin config and make a PATCH request with JSON body.
fn admin_patch(path: &str, body: &str) -> Result<serde_json::Value, String> {
    let cfg = config::load_admin_config()?;
    let resp = api::curl_panel_admin(&cfg, "PATCH", path, Some(body))?;
    serde_json::from_str(&resp)
        .map_err(|e| format!("Failed to parse response: {} — body: {}", e, safe_error_body(&resp)))
}

/// Helper: load admin config and make a PUT request with JSON body.
fn admin_put(path: &str, body: &str) -> Result<serde_json::Value, String> {
    let cfg = config::load_admin_config()?;
    let resp = api::curl_panel_admin(&cfg, "PUT", path, Some(body))?;
    serde_json::from_str(&resp)
        .map_err(|e| format!("Failed to parse response: {} — body: {}", e, safe_error_body(&resp)))
}

/// Helper: load admin config and make a DELETE request.
fn admin_delete(path: &str, body: Option<&str>) -> Result<serde_json::Value, String> {
    let cfg = config::load_admin_config()?;
    let resp = api::curl_panel_admin(&cfg, "DELETE", path, body)?;
    serde_json::from_str(&resp)
        .map_err(|e| format!("Failed to parse response: {} — body: {}", e, safe_error_body(&resp)))
}

/// Validate that a label is safe for use in filesystem paths.
/// Rejects path separators, `..' components, and control characters.
fn validate_label(label: &str) -> Result<(), String> {
    if label.is_empty() {
        return Err("Label must not be empty".to_string());
    }
    if label.contains('/') || label.contains('\\') || label.contains('\0') || label.contains("..") {
        return Err("Label contains invalid characters".to_string());
    }
    Ok(())
}

/// Validate that a server ID is safe for use in filesystem paths (UUID format).
fn validate_server_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("Server ID must not be empty".to_string());
    }
    if id.contains('/') || id.contains('\\') || id.contains('\0') || id.contains("..") {
        return Err("Server ID contains invalid characters".to_string());
    }
    Ok(())
}

// ===========================================================================
// 2FA
// ===========================================================================

#[tauri::command]
pub async fn admin_2fa_status() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/settings/2fa"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_2fa_setup() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_post("/api/settings/2fa/setup", None))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_2fa_confirm(code: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let body = serde_json::json!({ "code": code }).to_string();
        admin_post("/api/settings/2fa/confirm", Some(&body))
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_2fa_verify(code: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let cfg = config::load_admin_config()?;
        let json_body = serde_json::json!({ "code": code }).to_string();
        let (body, headers) = api::curl_panel_admin_with_headers(
            &cfg, "POST", "/api/settings/2fa/verify", Some(&json_body),
        )?;

        // Extract Set-Cookie header for 2FA session
        for line in headers.lines() {
            if let Some(cookie_part) = line.strip_prefix("Set-Cookie:").or_else(|| line.strip_prefix("set-cookie:")) {
                let cookie_part = cookie_part.trim();
                if cookie_part.starts_with("portlama_2fa_session=") {
                    // Extract just the cookie value (before ;)
                    let value = cookie_part
                        .split(';')
                        .next()
                        .unwrap_or("")
                        .strip_prefix("portlama_2fa_session=")
                        .unwrap_or("");
                    if !value.is_empty() {
                        if let Ok(server_id) = config::get_active_server_id() {
                            // Store for 12 hours (matching server session duration)
                            api::store_2fa_session(&server_id, value, 12 * 3600);
                        }
                    }
                }
            }
        }

        let result: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse response: {} — body: {}", e, safe_error_body(&body)))?;
        Ok(result)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_2fa_disable(code: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let body = serde_json::json!({ "code": code }).to_string();
        admin_post("/api/settings/2fa/disable", Some(&body))
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

// ===========================================================================
// Users
// ===========================================================================

#[tauri::command]
pub async fn admin_get_users() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/users"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_create_user(data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || admin_post("/api/users", Some(&data.to_string())))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_update_user(username: String, data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/users/{}", url_encode(&username));
        admin_put(&path, &data.to_string())
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_delete_user(username: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/users/{}", url_encode(&username));
        admin_delete(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_reset_totp(username: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/users/{}/reset-totp", url_encode(&username));
        admin_post(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

// ===========================================================================
// Invitations
// ===========================================================================

#[tauri::command]
pub async fn admin_get_invitations() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/invitations"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_create_invitation(data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || admin_post("/api/invitations", Some(&data.to_string())))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_revoke_invitation(id: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/invitations/{}", url_encode(&id));
        admin_delete(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

// ===========================================================================
// Sites
// ===========================================================================

#[tauri::command]
pub async fn admin_get_sites() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/sites"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_create_site(data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || admin_post("/api/sites", Some(&data.to_string())))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_delete_site(id: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/sites/{}", url_encode(&id));
        admin_delete(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_update_site(id: String, data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/sites/{}", url_encode(&id));
        admin_patch(&path, &data.to_string())
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_site_files(site_id: String, path: Option<String>) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let query = match path.as_deref() {
            Some(p) if p != "." => format!("?path={}", url_encode(p)),
            _ => String::new(),
        };
        let api_path = format!("/api/sites/{}/files{}", url_encode(&site_id), query);
        admin_get(&api_path)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_upload_site_files(
    site_id: String,
    path: Option<String>,
    file_paths: Vec<String>,
) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let cfg = config::load_admin_config()?;
        let api_path = format!("/api/sites/{}/files", url_encode(&site_id));
        let query = match path.as_deref() {
            Some(p) if p != "." => Some(format!("path={}", url_encode(p))),
            _ => None,
        };
        let body = api::curl_panel_admin_multipart(
            &cfg,
            &api_path,
            &file_paths,
            query.as_deref(),
        )?;
        serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse response: {} — body: {}", e, body))
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_delete_site_file(site_id: String, file_path: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let api_path = format!("/api/sites/{}/files", url_encode(&site_id));
        let body = serde_json::json!({ "path": file_path }).to_string();
        admin_delete(&api_path, Some(&body))
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_verify_site_dns(id: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/sites/{}/verify-dns", url_encode(&id));
        admin_post(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

// ===========================================================================
// Certificates
// ===========================================================================

#[tauri::command]
pub async fn admin_get_certs() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/certs"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_renew_cert(domain: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/certs/{}/renew", url_encode(&domain));
        admin_post(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_rotate_mtls() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_post("/api/certs/mtls/rotate", None))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_download_mtls() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let cfg = config::load_admin_config()?;
        let dest = config::agent_dir().join("admin-client.p12");
        api::curl_panel_admin_binary(&cfg, "/api/certs/mtls/download", &dest)?;
        Ok(dest.to_string_lossy().to_string())
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_auth_mode() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/certs/admin/auth-mode"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_auto_renew_status() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/certs/auto-renew-status"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_agent_certs() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/certs/agent"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_generate_agent_cert(data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || admin_post("/api/certs/agent", Some(&data.to_string())))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_revoke_agent_cert(label: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/certs/agent/{}", url_encode(&label));
        admin_delete(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_create_enrollment_token(data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || admin_post("/api/certs/agent/enroll", Some(&data.to_string())))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_update_agent_capabilities(label: String, capabilities: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/certs/agent/{}/capabilities", url_encode(&label));
        let body = serde_json::json!({ "capabilities": capabilities }).to_string();
        admin_patch(&path, &body)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_update_agent_allowed_sites(label: String, allowed_sites: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/certs/agent/{}/allowed-sites", url_encode(&label));
        let body = serde_json::json!({ "allowedSites": allowed_sites }).to_string();
        admin_patch(&path, &body)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_download_agent_cert(label: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        validate_label(&label)?;
        let cfg = config::load_admin_config()?;
        let dest = config::agent_dir().join(format!("{}.p12", label));
        let path = format!("/api/certs/agent/{}/download", url_encode(&label));
        api::curl_panel_admin_binary(&cfg, &path, &dest)?;
        Ok(dest.to_string_lossy().to_string())
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

// ===========================================================================
// Services + System
// ===========================================================================

#[tauri::command]
pub async fn admin_get_services() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/services"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_service_action(name: String, action: String) -> Result<serde_json::Value, String> {
    if !matches!(action.as_str(), "start" | "stop" | "restart") {
        return Err("Action must be 'start', 'stop', or 'restart'".to_string());
    }
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/services/{}/{}", url_encode(&name), url_encode(&action));
        admin_post(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_system_stats() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/system/stats"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

// ===========================================================================
// Tickets
// ===========================================================================

#[tauri::command]
pub async fn admin_get_ticket_scopes() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/tickets/scopes"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_create_ticket_scope(data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || admin_post("/api/tickets/scopes", Some(&data.to_string())))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_delete_ticket_scope(name: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/tickets/scopes/{}", url_encode(&name));
        admin_delete(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_ticket_instances() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/tickets/instances"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_delete_ticket_instance(id: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/tickets/instances/{}", url_encode(&id));
        admin_delete(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_ticket_assignments() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/tickets/assignments"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_create_ticket_assignment(data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || admin_post("/api/tickets/assignments", Some(&data.to_string())))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_delete_ticket_assignment(agent_label: String, instance_scope: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/tickets/assignments/{}/{}", url_encode(&agent_label), url_encode(&instance_scope));
        admin_delete(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_tickets() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/tickets"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_revoke_ticket(id: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/tickets/{}", url_encode(&id));
        admin_delete(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_ticket_sessions() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/tickets/sessions"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_kill_ticket_session(id: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/tickets/sessions/{}", url_encode(&id));
        admin_delete(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

// ===========================================================================
// Plugins
// ===========================================================================

#[tauri::command]
pub async fn admin_get_plugins() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/plugins"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_install_plugin(package_name: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let body = serde_json::json!({ "packageName": package_name }).to_string();
        admin_post("/api/plugins/install", Some(&body))
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_enable_plugin(name: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/{}/enable", url_encode(&name));
        admin_post(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_disable_plugin(name: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/{}/disable", url_encode(&name));
        admin_post(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_uninstall_plugin(name: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/{}", url_encode(&name));
        admin_delete(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_fetch_plugin_bundle(name: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let cfg = config::load_admin_config()?;
        let path = format!("/api/{}/panel.js", url_encode(&name));
        api::curl_panel_admin(&cfg, "GET", &path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_push_install_config() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/plugins/push-install/config"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_update_push_install_config(data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || admin_patch("/api/plugins/push-install/config", &data.to_string()))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_push_install_policies() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/plugins/push-install/policies"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_create_push_install_policy(data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || admin_post("/api/plugins/push-install/policies", Some(&data.to_string())))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_delete_push_install_policy(id: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/push-install/policies/{}", url_encode(&id));
        admin_delete(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_enable_push_install(label: String, data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/push-install/enable/{}", url_encode(&label));
        admin_post(&path, Some(&data.to_string()))
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_disable_push_install(label: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/push-install/enable/{}", url_encode(&label));
        admin_delete(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_push_install_command(label: String, data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/push-install/{}", url_encode(&label));
        admin_post(&path, Some(&data.to_string()))
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_push_install_sessions() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/plugins/push-install/sessions"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

// ===========================================================================
// Tunnels
// ===========================================================================

#[tauri::command]
pub async fn admin_get_tunnels() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/tunnels"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_create_tunnel(data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || admin_post("/api/tunnels", Some(&data.to_string())))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_toggle_tunnel(id: String, data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/tunnels/{}", url_encode(&id));
        admin_patch(&path, &data.to_string())
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_delete_tunnel(id: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/tunnels/{}", url_encode(&id));
        admin_delete(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_tunnel_agent_config() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/tunnels/agent-config"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_mac_plist(format: Option<String>) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let query = match format.as_deref() {
            Some(f) => format!("?format={}", url_encode(f)),
            None => String::new(),
        };
        let path = format!("/api/tunnels/mac-plist{}", query);
        admin_get(&path)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

// ===========================================================================
// Log Streaming (HTTP polling fallback — WebSocket bridge is future work)
// ===========================================================================

/// Start polling service logs via HTTP and emitting them as Tauri events.
/// Spawns a background task that polls every 2 seconds.
#[tauri::command]
pub async fn admin_start_log_stream(
    app_handle: tauri::AppHandle,
    service_name: String,
) -> Result<(), String> {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    let cancel_key = format!("log-stream-{}", service_name);
    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_clone = cancel.clone();

    // Store cancel flag in app state for stop command (max 5 concurrent streams)
    {
        let state = app_handle.state::<LogStreamState>();
        let mut streams = state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
        // Stop existing stream for this service
        if let Some(old_cancel) = streams.get(&cancel_key) {
            old_cancel.store(true, Ordering::Relaxed);
        } else if streams.len() >= 5 {
            return Err("Too many concurrent log streams (max 5)".to_string());
        }
        streams.insert(cancel_key, cancel_clone);
    }

    let svc = service_name.clone();
    let cancel_key_for_cleanup = format!("log-stream-{}", svc);
    tokio::task::spawn(async move {
        let mut last_lines: usize = 0;
        loop {
            if cancel.load(Ordering::Relaxed) {
                break;
            }

            // Fetch logs via admin API
            let svc_clone = svc.clone();
            let result = tokio::task::spawn_blocking(move || {
                let cfg = config::load_admin_config()?;
                let path = format!("/api/services/{}/logs", url_encode(&svc_clone));
                api::curl_panel_admin(&cfg, "GET", &path, None)
            })
            .await;

            if let Ok(Ok(body)) = result {
                if let Ok(data) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(lines) = data.get("lines").and_then(|l| l.as_array()) {
                        // Emit only new lines since last poll
                        let new_lines = if lines.len() > last_lines {
                            &lines[last_lines..]
                        } else if lines.len() < last_lines {
                            // Log was rotated or truncated
                            lines.as_slice()
                        } else {
                            &[]
                        };

                        for line in new_lines {
                            let payload = serde_json::json!({
                                "service": svc,
                                "message": line.get("message").and_then(|m| m.as_str()).unwrap_or(""),
                                "timestamp": line.get("timestamp").and_then(|t| t.as_str()).unwrap_or(""),
                            });
                            let _ = app_handle.emit("admin-log-line", payload);
                        }
                        last_lines = lines.len();
                    }
                }
            }

            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }

        // Clean up entry from state when task exits
        drop({
            let state = app_handle.state::<LogStreamState>();
            let _ = state.0.lock().map(|mut streams| {
                streams.remove(&cancel_key_for_cleanup);
            });
            state
        });
    });

    Ok(())
}

/// Stop an active log stream for a service.
#[tauri::command]
pub async fn admin_stop_log_stream(
    app_handle: tauri::AppHandle,
    service_name: String,
) -> Result<(), String> {
    let cancel_key = format!("log-stream-{}", service_name);
    let state = app_handle.state::<LogStreamState>();
    let mut streams = state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
    if let Some(cancel) = streams.remove(&cancel_key) {
        cancel.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(())
}

/// State container for active log streams.
pub struct LogStreamState(pub std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<std::sync::atomic::AtomicBool>>>);
