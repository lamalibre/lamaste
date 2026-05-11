//! Per-agent Tauri commands consumed by the desktop AgentClient.
//!
//! Each command is a thin REST proxy to `lamaste-agentd` on
//! `127.0.0.1:9393`. Authentication uses the per-user Bearer token at
//! `~/.lamalibre/lamaste/agentd.token` (mode 0600), handled by
//! `crate::api::curl_agent_local_panel`.
//!
//! These commands intentionally do not duplicate business logic in Rust —
//! the daemon owns the `@lamalibre/lamaste/agent` library calls, and the
//! desktop is a container that forwards user actions over HTTP.

use serde_json::Value;

use crate::agents::{validate_agent_label, AGENT_PANEL_PORT};
use crate::api::curl_agent_local_panel;

/// Parse the agentd response body and return either the JSON value or an
/// error message extracted from `{ error: "..." }` if present.
fn parse_response(body: &str) -> Result<Value, String> {
    if body.is_empty() {
        return Ok(Value::Null);
    }
    let value: Value = serde_json::from_str(body)
        .map_err(|e| format!("Failed to parse agentd response: {}", e))?;
    if let Some(err) = value.get("error").and_then(|e| e.as_str()) {
        return Err(err.to_string());
    }
    Ok(value)
}

/// POST /api/update — re-fetches the agent config from the panel and restarts chisel.
#[tauri::command]
pub async fn update_agent(label: String) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;
        let body = curl_agent_local_panel(&label, AGENT_PANEL_PORT, "POST", "/api/update", None)?;
        parse_response(&body)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// POST /api/tunnels — create a new tunnel for the given agent.
#[tauri::command]
pub async fn create_tunnel(
    label: String,
    subdomain: String,
    port: u32,
    description: Option<String>,
) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;
        // Defense-in-depth: validate inputs before round-tripping to agentd.
        // The panel server enforces the full ruleset; these checks just keep
        // obvious garbage out of the JSON body.
        if subdomain.is_empty() || subdomain.len() > 63 {
            return Err("subdomain must be 1-63 characters".to_string());
        }
        if !subdomain
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        {
            return Err("subdomain must be lowercase alphanumeric with hyphens".to_string());
        }
        if port < 1 || port > 65_535 {
            return Err("port must be between 1 and 65535".to_string());
        }

        let body = serde_json::json!({
            "subdomain": subdomain,
            "port": port,
            "description": description.unwrap_or_default(),
        });
        let resp = curl_agent_local_panel(
            &label,
            AGENT_PANEL_PORT,
            "POST",
            "/api/tunnels",
            Some(&body.to_string()),
        )?;
        parse_response(&resp)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// PATCH /api/tunnels/<id> — toggle tunnel enabled state.
#[tauri::command]
pub async fn toggle_tunnel(label: String, id: String, enabled: bool) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;
        validate_tunnel_id(&id)?;
        let body = serde_json::json!({ "enabled": enabled });
        let path = format!("/api/tunnels/{}", id);
        let resp = curl_agent_local_panel(
            &label,
            AGENT_PANEL_PORT,
            "PATCH",
            &path,
            Some(&body.to_string()),
        )?;
        parse_response(&resp)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// DELETE /api/tunnels/<id> — remove a tunnel.
#[tauri::command]
pub async fn delete_tunnel(label: String, id: String) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;
        validate_tunnel_id(&id)?;
        let path = format!("/api/tunnels/{}", id);
        let resp = curl_agent_local_panel(&label, AGENT_PANEL_PORT, "DELETE", &path, None)?;
        parse_response(&resp)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// POST /api/certificate/rotate — rotate the agent's mTLS certificate.
#[tauri::command]
pub async fn rotate_certificate(label: String) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;
        let resp = curl_agent_local_panel(
            &label,
            AGENT_PANEL_PORT,
            "POST",
            "/api/certificate/rotate",
            None,
        )?;
        parse_response(&resp)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// GET /api/certificate/download — return the binary P12 certificate bytes.
///
/// The agent daemon returns either raw P12 bytes (when `authMethod` is
/// `p12`) or a JSON error body. Hardware-bound (Keychain) certs surface as
/// HTTP 410, in which case we propagate the error message to the UI.
#[tauri::command]
pub async fn download_certificate(label: String) -> Result<Vec<u8>, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;
        download_certificate_blocking(&label)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

fn download_certificate_blocking(label: &str) -> Result<Vec<u8>, String> {
    use std::process::Command;

    let token = crate::api::agentd_token()?;
    let url = format!(
        "http://127.0.0.1:{}/api/certificate/download",
        AGENT_PANEL_PORT
    );

    // Capture HTTP status and body separately so we can detect a JSON error
    // (which indicates the daemon returned a 4xx instead of P12 bytes).
    let output = Command::new("curl")
        .args([
            "-s",
            "-H",
            &format!("Authorization: Bearer {}", token),
            "-w",
            "\n%{http_code}",
            &url,
        ])
        .output()
        .map_err(|e| format!("Failed to run curl: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Request failed: {}", stderr));
    }

    // Split off the trailing "\nHTTP_STATUS" appended by -w. We must do this
    // on the raw bytes since the body itself is binary.
    let stdout = output.stdout;
    let split_idx = stdout
        .iter()
        .rposition(|&b| b == b'\n')
        .ok_or_else(|| "Malformed curl response: missing status code".to_string())?;
    let body = &stdout[..split_idx];
    let status_str = std::str::from_utf8(&stdout[split_idx + 1..])
        .map_err(|e| format!("Invalid status code encoding: {}", e))?
        .trim();
    let status: u16 = status_str
        .parse()
        .map_err(|e| format!("Invalid HTTP status \"{}\": {}", status_str, e))?;

    if !(200..300).contains(&status) {
        // Try to extract a JSON error message; fall back to the raw body.
        if let Ok(text) = std::str::from_utf8(body) {
            if let Ok(json) = serde_json::from_str::<Value>(text) {
                if let Some(err) = json.get("error").and_then(|e| e.as_str()) {
                    return Err(err.to_string());
                }
            }
            if !text.is_empty() {
                return Err(format!("HTTP {}: {}", status, text.trim()));
            }
        }
        return Err(format!("HTTP {}", status));
    }

    let _ = label; // retained for symmetry with other helpers and future use
    Ok(body.to_vec())
}

/// Top-level app status, polled by App.jsx every 3 seconds (no label arg).
///
/// Returns the shape that App.jsx consumes:
/// `{ configured: bool, setupMessage?: string, chisel: { running: bool } }`.
///
/// `configured` is true when at least one agent or server is registered.
/// `setupMessage` is omitted when `configured` is true.
/// `chisel.running` reflects whether ANY chisel agent service is loaded —
/// the tray-state effect uses it as a coarse "is anything online" signal
/// when there are zero agents in the multi-agent registry.
///
/// Per-agent status is exposed by `get_agent_status(label)` (in `agents.rs`).
#[tauri::command]
pub async fn get_status() -> Result<Value, String> {
    tokio::task::spawn_blocking(|| -> Result<Value, String> {
        let agents_registry = crate::agents::load_agents_registry().unwrap_or(None);
        let agents = agents_registry
            .as_ref()
            .map(|r| r.agents.as_slice())
            .unwrap_or(&[]);

        let servers_path = crate::config::servers_registry_path();
        let servers_exist = servers_path.exists()
            && std::fs::read_to_string(&servers_path)
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                .and_then(|v| v.get("servers").cloned())
                .and_then(|v| v.as_array().map(|a| !a.is_empty()))
                .unwrap_or(false);

        let configured = !agents.is_empty() || servers_exist;

        // Coarse chisel-running signal: true if ANY agent service is loaded.
        let chisel_running = agents.iter().any(|a| {
            let (running, _) = crate::agents::get_agent_chisel_status(&a.label);
            running
        });

        let mut payload = serde_json::json!({
            "configured": configured,
            "chisel": { "running": chisel_running },
        });
        if !configured {
            payload["setupMessage"] = Value::String(
                "Run `npx @lamalibre/lamaste-agent setup` to connect to a Lamaste server, \
                 or use \"Create a new server\" to provision one."
                    .to_string(),
            );
        }
        Ok(payload)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Validate a tunnel ID. Tunnels use UUIDs; we accept the exact format the
/// agent daemon uses so malformed IDs fail fast in Rust.
fn validate_tunnel_id(id: &str) -> Result<(), String> {
    let bytes = id.as_bytes();
    if bytes.len() != 36 {
        return Err("Invalid tunnel ID".to_string());
    }
    for (i, &b) in bytes.iter().enumerate() {
        match i {
            8 | 13 | 18 | 23 => {
                if b != b'-' {
                    return Err("Invalid tunnel ID".to_string());
                }
            }
            _ => {
                if !b.is_ascii_hexdigit() {
                    return Err("Invalid tunnel ID".to_string());
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_tunnel_id;

    #[test]
    fn accepts_uuid() {
        assert!(validate_tunnel_id("123e4567-e89b-12d3-a456-426614174000").is_ok());
    }

    #[test]
    fn rejects_garbage() {
        assert!(validate_tunnel_id("../../../etc/passwd").is_err());
        assert!(validate_tunnel_id("").is_err());
        assert!(validate_tunnel_id("123").is_err());
    }
}
