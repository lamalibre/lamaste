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

/// A refusal as the commands that start plugin operations reject with it.
fn refusal(message: String) -> serde_json::Value {
    serde_json::json!({ "error": message })
}

/// Helper: a request that starts a plugin operation (hosting, removing a
/// hosting, uninstalling, updating, approving an update). A refusal keeps
/// what the panel said beyond its message, for the panel UI to explain it:
/// the command rejects with `{ error, code?, reasons?, operationId? }` —
/// `code` `agent_not_eligible` (with the agent's `reasons`),
/// `push_install_refused` or `hooks_not_approved`.
fn admin_operation(method: &str, path: &str, body: Option<&str>) -> Result<serde_json::Value, serde_json::Value> {
    let cfg = config::load_admin_config().map_err(refusal)?;
    let resp = api::curl_panel_admin_response(&cfg, method, path, body).map_err(refusal)?;
    let value: serde_json::Value = serde_json::from_str(&resp).map_err(|e| {
        refusal(format!("Failed to parse response: {} — body: {}", e, safe_error_body(&resp)))
    })?;
    let Some(error) = api::panel_error_text(&value) else {
        return Ok(value);
    };
    let mut answer = serde_json::Map::new();
    answer.insert("error".to_string(), serde_json::Value::String(error));
    if let Some(code) = value.get("code").filter(|c| c.is_string()) {
        answer.insert("code".to_string(), code.clone());
    }
    if let Some(reasons) = value.get("reasons").filter(|r| r.is_array()) {
        answer.insert("reasons".to_string(), reasons.clone());
    }
    if let Some(id) = value.get("operationId").filter(|i| i.is_string()) {
        answer.insert("operationId".to_string(), id.clone());
    }
    Err(serde_json::Value::Object(answer))
}

/// `?force=true&purge=true` for removing a plugin's hosting, with only the
/// flags that are set: `force` lets failing pre-teardown hooks pass, `purge`
/// deletes the data and service account of an agent half Lamaste installed.
fn removal_query(force: Option<bool>, purge: Option<bool>) -> String {
    let mut query = serde_json::Map::new();
    if force.unwrap_or(false) {
        query.insert("force".to_string(), serde_json::Value::Bool(true));
    }
    if purge.unwrap_or(false) {
        query.insert("purge".to_string(), serde_json::Value::Bool(true));
    }
    query_string(&serde_json::Value::Object(query))
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
                if cookie_part.starts_with("lamaste_2fa_session=") {
                    // Extract just the cookie value (before ;)
                    let value = cookie_part
                        .split(';')
                        .next()
                        .unwrap_or("")
                        .strip_prefix("lamaste_2fa_session=")
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
pub async fn admin_revoke_enrollment_token(label: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/certs/agent/enroll/{}", url_encode(&label));
        admin_delete(&path, None)
    })
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
pub async fn admin_uninstall_plugin(
    name: String,
    force: Option<bool>,
    purge: Option<bool>,
) -> Result<serde_json::Value, serde_json::Value> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/{}{}", url_encode(&name), removal_query(force, purge));
        admin_operation("DELETE", &path, None)
    })
    .await.map_err(|e| refusal(format!("Task failed: {}", e)))?
}

// --- Hosting an agent-hosted plugin's agent half on an agent ---

#[tauri::command]
pub async fn admin_get_plugin_hosting(name: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/{}/hosting", url_encode(&name));
        admin_get(&path)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_plugin_hosting_eligibility(name: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/{}/hosting/eligibility", url_encode(&name));
        admin_get(&path)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_set_plugin_hosting(
    name: String,
    agent_label: String,
) -> Result<serde_json::Value, serde_json::Value> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/{}/hosting", url_encode(&name));
        let body = serde_json::json!({ "agentLabel": agent_label }).to_string();
        admin_operation("POST", &path, Some(&body))
    })
    .await.map_err(|e| refusal(format!("Task failed: {}", e)))?
}

#[tauri::command]
pub async fn admin_clear_plugin_hosting(
    name: String,
    force: Option<bool>,
    purge: Option<bool>,
) -> Result<serde_json::Value, serde_json::Value> {
    tokio::task::spawn_blocking(move || {
        let path = format!(
            "/api/plugins/{}/hosting{}",
            url_encode(&name),
            removal_query(force, purge)
        );
        admin_operation("DELETE", &path, None)
    })
    .await.map_err(|e| refusal(format!("Task failed: {}", e)))?
}

#[tauri::command]
pub async fn admin_get_plugin_operations(name: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/{}/operations", url_encode(&name));
        admin_get(&path)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_plugin_operation(name: String, id: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/{}/operations/{}", url_encode(&name), url_encode(&id));
        admin_get(&path)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

// --- Retained data: what agents keep of agent halves removed without purge ---

/// `/api/plugins/<name>/retained-data?agentLabel=<label>[&forget=true]`.
fn retained_data_path(name: &str, agent_label: &str, forget: bool) -> String {
    let mut query = serde_json::Map::new();
    query.insert("agentLabel".to_string(), serde_json::Value::String(agent_label.to_string()));
    if forget {
        query.insert("forget".to_string(), serde_json::Value::Bool(true));
    }
    format!(
        "/api/plugins/{}/retained-data{}",
        url_encode(name),
        query_string(&serde_json::Value::Object(query))
    )
}

#[tauri::command]
pub async fn admin_get_plugin_retained_data(name: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/{}/retained-data", url_encode(&name));
        admin_get(&path)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

/// Purge what agent `agent_label` keeps of the plugin's agent half — an
/// operation, push-gated as `uninstall`; a refusal keeps its `code`.
#[tauri::command]
pub async fn admin_purge_plugin_retained_data(
    name: String,
    agent_label: String,
) -> Result<serde_json::Value, serde_json::Value> {
    tokio::task::spawn_blocking(move || {
        admin_operation("DELETE", &retained_data_path(&name, &agent_label, false), None)
    })
    .await.map_err(|e| refusal(format!("Task failed: {}", e)))?
}

/// Drop only the relay's record of what agent `agent_label` keeps; the
/// agent is not touched. A refusal keeps its `code` (`retained_data_in_use`).
#[tauri::command]
pub async fn admin_forget_plugin_retained_data(
    name: String,
    agent_label: String,
) -> Result<serde_json::Value, serde_json::Value> {
    tokio::task::spawn_blocking(move || {
        admin_operation("DELETE", &retained_data_path(&name, &agent_label, true), None)
    })
    .await.map_err(|e| refusal(format!("Task failed: {}", e)))?
}

// --- Lifecycle hooks: review, approval, auto-approve; updating in place ---

#[tauri::command]
pub async fn admin_get_plugin_hooks(name: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/{}/hooks", url_encode(&name));
        admin_get(&path)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

/// The body of `POST /api/plugins/:name/hooks/approve`: the digest that was
/// shown (`null` for an update with no relay hooks or agent half) and, for a
/// pending update, its version — left out when there is none, as the panel
/// takes no `null` version.
fn approve_hooks_body(digest: Option<String>, version: Option<String>) -> serde_json::Value {
    let mut body = serde_json::Map::new();
    body.insert("digest".to_string(), serde_json::json!(digest));
    if let Some(version) = version {
        body.insert("version".to_string(), serde_json::json!(version));
    }
    serde_json::Value::Object(body)
}

#[tauri::command]
pub async fn admin_approve_plugin_hooks(
    name: String,
    digest: Option<String>,
    version: Option<String>,
) -> Result<serde_json::Value, serde_json::Value> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/{}/hooks/approve", url_encode(&name));
        let body = approve_hooks_body(digest, version).to_string();
        // Approving a pending update starts it.
        admin_operation("POST", &path, Some(&body))
    })
    .await.map_err(|e| refusal(format!("Task failed: {}", e)))?
}

#[tauri::command]
pub async fn admin_set_plugin_hooks_auto_approve(name: String, enabled: bool) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/{}/hooks/auto-approve", url_encode(&name));
        let body = serde_json::json!({ "enabled": enabled }).to_string();
        admin_put(&path, &body)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_update_plugin(
    name: String,
    version: Option<String>,
) -> Result<serde_json::Value, serde_json::Value> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/{}/update", url_encode(&name));
        let body = match version {
            Some(v) => serde_json::json!({ "version": v }),
            None => serde_json::json!({}),
        }
        .to_string();
        admin_operation("POST", &path, Some(&body))
    })
    .await.map_err(|e| refusal(format!("Task failed: {}", e)))?
}

#[tauri::command]
pub async fn admin_discard_plugin_update(name: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/{}/update", url_encode(&name));
        admin_delete(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

// --- Settings of an agent-hosted plugin (kept by its agent half) ---

/// A refused panel request as the settings commands reject with it: the
/// panel's message (`error`, with what a failed validation found), the HTTP
/// `status`, and what the panel UI acts on — `code`, `reasons`,
/// `operationId`, `errors` (a message per setting, or `_`), the current
/// `revision` (`revision_mismatch`) and the `hosting` (`hosting_offline`).
/// Built from the panel's answer only, never from the request, so a secret
/// of the change cannot end up in it (the panel's messages hold no value).
fn panel_refusal(status: u16, body: &str) -> serde_json::Value {
    let value = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .filter(|v| v.is_object());
    let error = value
        .as_ref()
        .and_then(api::panel_error_text)
        .unwrap_or_else(|| {
            let text = body.trim();
            if text.is_empty() {
                format!("Request failed with status {}", status)
            } else {
                format!("Request failed with status {}: {}", status, safe_error_body(text))
            }
        });
    let mut answer = serde_json::Map::new();
    answer.insert("error".to_string(), serde_json::Value::String(error));
    answer.insert("status".to_string(), serde_json::Value::from(status));
    if let Some(value) = value {
        for key in REFUSAL_FIELDS {
            if let Some(field) = value.get(key).filter(|f| refusal_field_kept(key, f)) {
                answer.insert(key.to_string(), field.clone());
            }
        }
    }
    serde_json::Value::Object(answer)
}

/// What `panel_refusal` passes on beyond the message and the status.
const REFUSAL_FIELDS: [&str; 6] = ["code", "reasons", "operationId", "errors", "revision", "hosting"];

/// Whether a field of a refusal has the shape the panel UI reads it in.
fn refusal_field_kept(key: &str, field: &serde_json::Value) -> bool {
    match key {
        "code" | "operationId" => field.is_string(),
        "reasons" => field.is_array(),
        "errors" => field.is_object(),
        "revision" => field.is_u64(),
        "hosting" => field.is_object() || field.is_null(),
        _ => false,
    }
}

/// Helper: a panel request whose refusal the panel UI answers by what the
/// panel sent with it. Resolves with the panel's JSON body on a 2xx status;
/// rejects with `panel_refusal` otherwise, or with `{ error }` when the
/// request did not complete.
fn admin_refusable(
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<serde_json::Value, serde_json::Value> {
    let cfg = config::load_admin_config().map_err(refusal)?;
    let (status, resp) = api::curl_panel_admin_status(&cfg, method, path, body).map_err(refusal)?;
    if !(200..300).contains(&status) {
        return Err(panel_refusal(status, &resp));
    }
    serde_json::from_str(&resp).map_err(|e| {
        refusal(format!("Failed to parse response: {} — body: {}", e, safe_error_body(&resp)))
    })
}

/// `/api/plugins/<name>/settings`, for a name the panel could have given a plugin.
fn plugin_settings_path(name: &str) -> Result<String, serde_json::Value> {
    crate::local_plugins::validate_plugin_name(name).map_err(refusal)?;
    Ok(format!("/api/plugins/{}/settings", url_encode(name)))
}

/// The settings of a plugin whose manifest declares them: the fields, each
/// non-secret field's effective value, a secret only as `{ set, setAt }`,
/// and the hosting. Rejects with the panel's refusal (`code` `no_settings`).
#[tauri::command]
pub async fn admin_get_plugin_settings(name: String) -> Result<serde_json::Value, serde_json::Value> {
    let path = plugin_settings_path(&name)?;
    tokio::task::spawn_blocking(move || admin_refusable("GET", &path, None))
        .await
        .map_err(|e| refusal(format!("Task failed: {}", e)))?
}

/// A partial change `{ revision, values?, secrets? }`, answered with the new
/// settings. The body carries secrets: it reaches curl on stdin (never an
/// argument), and nothing here logs it or puts it into an error. Rejects
/// with the panel's refusal — `code` (`revision_mismatch` with `revision`,
/// `hosting_offline` with `hosting`, …) and `errors` per setting.
#[tauri::command]
pub async fn admin_update_plugin_settings(
    name: String,
    data: serde_json::Value,
) -> Result<serde_json::Value, serde_json::Value> {
    let path = plugin_settings_path(&name)?;
    if !data.is_object() {
        return Err(refusal(
            "A settings change is a JSON object: { revision, values?, secrets? }".to_string(),
        ));
    }
    tokio::task::spawn_blocking(move || {
        let body = data.to_string();
        drop(data);
        admin_refusable("PUT", &path, Some(&body))
    })
    .await
    .map_err(|e| refusal(format!("Task failed: {}", e)))?
}

// --- Audit log and panel notifications ---

/// `?key=value&…` from a JSON object of query values (strings, numbers, booleans).
fn query_string(query: &serde_json::Value) -> String {
    let mut parts = Vec::new();
    if let Some(map) = query.as_object() {
        for (key, value) in map {
            let text = match value {
                serde_json::Value::String(s) if !s.is_empty() => s.clone(),
                serde_json::Value::Number(n) => n.to_string(),
                serde_json::Value::Bool(b) => b.to_string(),
                _ => continue,
            };
            parts.push(format!("{}={}", url_encode(key), url_encode(&text)));
        }
    }
    if parts.is_empty() { String::new() } else { format!("?{}", parts.join("&")) }
}

#[tauri::command]
pub async fn admin_get_audit_log(query: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || admin_get(&format!("/api/audit{}", query_string(&query))))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_notifications(query: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        admin_get(&format!("/api/notifications{}", query_string(&query)))
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_mark_notifications_read(target: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        admin_post("/api/notifications/read", Some(&target.to_string()))
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_rotate_plugin_hosting_secret(name: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/{}/hosting/rotate-secret", url_encode(&name));
        admin_post(&path, None)
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
// System Update
// ===========================================================================

#[tauri::command]
pub async fn admin_trigger_panel_update(data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || admin_post("/api/system/update", Some(&data.to_string())))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

// ===========================================================================
// Storage
// ===========================================================================

#[tauri::command]
pub async fn admin_register_storage_server(data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || admin_post("/api/storage/servers", Some(&data.to_string())))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_storage_servers() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/storage/servers"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_delete_storage_server(id: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        validate_server_id(&id)?;
        let path = format!("/api/storage/servers/{}", url_encode(&id));
        admin_delete(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_create_storage_binding(data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || admin_post("/api/storage/bindings", Some(&data.to_string())))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_storage_bindings() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/storage/bindings"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_storage_binding(plugin_name: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/storage/bindings/{}", url_encode(&plugin_name));
        admin_get(&path)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_delete_storage_binding(plugin_name: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/storage/bindings/{}", url_encode(&plugin_name));
        admin_delete(&path, None)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

// ===========================================================================
// Identity
// ===========================================================================

#[tauri::command]
pub async fn admin_get_identity_self() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/identity/self"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_identity_users() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/identity/users"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_identity_user(username: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/identity/users/{}", url_encode(&username));
        admin_get(&path)
    })
    .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_get_identity_groups() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/identity/groups"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

// ===========================================================================
// Plugins: Push Install Policy Update
// ===========================================================================

#[tauri::command]
pub async fn admin_update_push_install_policy(id: String, data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/plugins/push-install/policies/{}", url_encode(&id));
        admin_patch(&path, &data.to_string())
    })
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
pub async fn admin_update_tunnel(id: String, data: serde_json::Value) -> Result<serde_json::Value, String> {
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

// --- User Plugin Access ---

#[tauri::command]
pub async fn admin_get_user_access_grants() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/user-access/grants"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_create_user_access_grant(data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || admin_post("/api/user-access/grants", Some(&data.to_string())))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_revoke_user_access_grant(grant_id: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/user-access/grants/{}", url_encode(&grant_id));
        admin_delete(&path, None)
    })
        .await.map_err(|e| format!("Task failed: {}", e))?
}

// --- Gatekeeper Groups ---

#[tauri::command]
pub async fn admin_get_gatekeeper_groups() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/gatekeeper/groups"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_create_gatekeeper_group(data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || admin_post("/api/gatekeeper/groups", Some(&data.to_string())))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_update_gatekeeper_group(name: String, data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/gatekeeper/groups/{}", url_encode(&name));
        admin_patch(&path, &data.to_string())
    })
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_delete_gatekeeper_group(name: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/gatekeeper/groups/{}", url_encode(&name));
        admin_delete(&path, None)
    })
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_add_gatekeeper_group_members(name: String, data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/gatekeeper/groups/{}/members", url_encode(&name));
        admin_post(&path, Some(&data.to_string()))
    })
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_remove_gatekeeper_group_member(name: String, username: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/gatekeeper/groups/{}/members/{}", url_encode(&name), url_encode(&username));
        admin_delete(&path, None)
    })
        .await.map_err(|e| format!("Task failed: {}", e))?
}

// --- Gatekeeper Grants ---

#[tauri::command]
pub async fn admin_get_gatekeeper_grants(filter: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = if let Some(f) = filter {
            let mut qs = String::from("/api/gatekeeper/grants?");
            if let Some(obj) = f.as_object() {
                for (k, v) in obj {
                    if let Some(s) = v.as_str() {
                        qs.push_str(&format!("{}={}&", url_encode(k), url_encode(s)));
                    }
                }
            }
            qs.trim_end_matches('&').to_string()
        } else {
            "/api/gatekeeper/grants".to_string()
        };
        admin_get(&path)
    })
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_create_gatekeeper_grant(data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || admin_post("/api/gatekeeper/grants", Some(&data.to_string())))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_revoke_gatekeeper_grant(grant_id: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/gatekeeper/grants/{}", url_encode(&grant_id));
        admin_delete(&path, None)
    })
        .await.map_err(|e| format!("Task failed: {}", e))?
}

// --- Gatekeeper Diagnostics ---

#[tauri::command]
pub async fn admin_check_gatekeeper_access(username: String, resource_type: String, resource_id: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!(
            "/api/gatekeeper/access/check?username={}&resourceType={}&resourceId={}",
            url_encode(&username), url_encode(&resource_type), url_encode(&resource_id)
        );
        admin_get(&path)
    })
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_bust_gatekeeper_cache() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_post("/api/gatekeeper/cache/bust", None))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

// --- Gatekeeper Settings ---

#[tauri::command]
pub async fn admin_get_gatekeeper_settings() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_get("/api/gatekeeper/settings"))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_update_gatekeeper_settings(data: serde_json::Value) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || admin_patch("/api/gatekeeper/settings", &data.to_string()))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

// --- Gatekeeper Access Log ---

#[tauri::command]
pub async fn admin_get_access_request_log(limit: Option<u32>, offset: Option<u32>) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let l = limit.unwrap_or(100);
        let o = offset.unwrap_or(0);
        let path = format!("/api/gatekeeper/access-log?limit={}&offset={}", l, o);
        admin_get(&path)
    })
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn admin_clear_access_request_log() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| admin_delete("/api/gatekeeper/access-log", None))
        .await.map_err(|e| format!("Task failed: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_approval_names_the_digest_and_the_version_only_when_there_is_one() {
        assert_eq!(
            approve_hooks_body(Some("ab".repeat(32)), Some("1.2.0".to_string())),
            serde_json::json!({ "digest": "ab".repeat(32), "version": "1.2.0" })
        );
        // An update with no relay hooks or agent half has no digest.
        assert_eq!(
            approve_hooks_body(None, Some("1.2.0".to_string())),
            serde_json::json!({ "digest": null, "version": "1.2.0" })
        );
        // The panel takes no null version: it is left out.
        assert_eq!(
            approve_hooks_body(Some("ab".repeat(32)), None),
            serde_json::json!({ "digest": "ab".repeat(32) })
        );
    }

    #[test]
    fn a_settings_refusal_keeps_what_the_panel_ui_acts_on() {
        let body = serde_json::json!({
            "error": "Invalid settings",
            "errors": { "retries": "Must be at most 10", "_": "Something about the whole" },
            "code": "revision_mismatch",
            "revision": 7,
            "operationId": "op-1",
            "reasons": ["a reason"],
            "hosting": null,
            // Nothing else of the answer is passed on.
            "values": { "apiKey": "never-passed-on" },
        })
        .to_string();
        assert_eq!(
            panel_refusal(422, &body),
            serde_json::json!({
                "error": "Invalid settings",
                "status": 422,
                "errors": { "retries": "Must be at most 10", "_": "Something about the whole" },
                "code": "revision_mismatch",
                "revision": 7,
                "operationId": "op-1",
                "reasons": ["a reason"],
                "hosting": null,
            })
        );
        let hosting = serde_json::json!({ "agentLabel": "vm1", "state": "down", "reason": "tunnel" });
        let offline = serde_json::json!({
            "error": "Hosting agent \"vm1\" is offline",
            "code": "hosting_offline",
            "hosting": hosting,
        })
        .to_string();
        assert_eq!(panel_refusal(503, &offline)["hosting"], hosting);
    }

    #[test]
    fn a_settings_refusal_leaves_out_fields_of_the_wrong_shape() {
        let body = serde_json::json!({
            "error": "x",
            "errors": "not per setting",
            "code": 7,
            "revision": -1,
            "hosting": "vm1",
            "operationId": ["op"],
        })
        .to_string();
        assert_eq!(
            panel_refusal(409, &body),
            serde_json::json!({ "error": "x", "status": 409 })
        );
    }

    #[test]
    fn a_refusal_without_a_json_error_says_the_status() {
        assert_eq!(
            panel_refusal(502, "<html>Bad Gateway</html>"),
            serde_json::json!({
                "error": "Request failed with status 502: <html>Bad Gateway</html>",
                "status": 502,
            })
        );
        assert_eq!(
            panel_refusal(0, ""),
            serde_json::json!({ "error": "Request failed with status 0", "status": 0 })
        );
        // An object without an error message.
        assert_eq!(panel_refusal(500, "{}")["error"], "Request failed with status 500: {}");
    }

    #[test]
    fn a_settings_path_takes_only_a_plugin_name() {
        assert_eq!(plugin_settings_path("fx-2").unwrap(), "/api/plugins/fx-2/settings");
        for bad in ["", "../fx", "fx/settings", "Fx", "fx?x=1", "fx%2F", "settings"] {
            let err = plugin_settings_path(bad).unwrap_err();
            assert!(err["error"].is_string(), "{}", bad);
        }
    }
}
