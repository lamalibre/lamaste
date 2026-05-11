use crate::config;
use crate::credentials;
use std::io::{BufRead, Write};
use std::path::PathBuf;

/// Resolve the path to the create-lamaste-admin CLI entry point.
fn admin_upgrade_cli_path() -> PathBuf {
    let workspace_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../create-lamaste-admin/bin/create-lamaste-admin.js");
    if let Ok(canonical) = workspace_path.canonicalize() {
        if canonical.exists() {
            return canonical;
        }
    }
    PathBuf::from("create-lamaste-admin")
}

/// Atomically write servers.json: tmp -> fsync -> chmod 0600 -> rename.
fn atomic_write_servers(servers: &[serde_json::Value]) -> Result<(), String> {
    let registry_path = config::servers_registry_path();
    let json = serde_json::to_string_pretty(servers)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    let tmp_path = registry_path.with_extension("json.tmp");
    {
        let mut file = std::fs::File::create(&tmp_path)
            .map_err(|e| format!("Failed to create temp file: {}", e))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("Failed to write: {}", e))?;
        file.sync_all()
            .map_err(|e| format!("Failed to fsync: {}", e))?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Failed to set permissions: {}", e))?;
    }
    std::fs::rename(&tmp_path, &registry_path)
        .map_err(|e| format!("Failed to save: {}", e))?;
    Ok(())
}

/// Upgrade a server's admin certificate to hardware-bound (macOS Keychain).
///
/// Shells out to `create-lamaste-admin --json` which handles:
/// - Key generation, CSR, panel upgrade POST
/// - CA trust in login keychain
/// - P12 creation for curl-based tools
/// - Keychain identity import (non-extractable) for browser mTLS
///
/// This command reads the NDJSON output, stores the new P12 password
/// in the credential store, and updates servers.json.
#[tauri::command]
pub async fn upgrade_admin_to_hardware_bound(server_id: String) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        return Err("Hardware-bound certificates require macOS Keychain.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        tokio::task::spawn_blocking(move || upgrade_impl(&server_id))
            .await
            .map_err(|e| format!("Task failed: {}", e))?
    }
}

#[cfg(target_os = "macos")]
fn upgrade_impl(server_id: &str) -> Result<(), String> {
    // 1. Load admin config for this server
    let admin_cfg = config::load_admin_config_for_server_id(server_id)?;

    if admin_cfg.auth_method == "keychain" {
        return Err("Admin certificate is already hardware-bound.".to_string());
    }

    let p12_path = admin_cfg
        .p12_path
        .as_deref()
        .ok_or("No P12 path configured for this server")?;
    let p12_password = admin_cfg
        .p12_password
        .as_deref()
        .ok_or("No P12 password found in credential store")?;

    // 2. Compute output P12 path
    let server_dir = config::agent_dir().join("servers").join(server_id);
    std::fs::create_dir_all(&server_dir)
        .map_err(|e| format!("Failed to create server directory: {}", e))?;
    let output_p12_path = server_dir.join("admin.p12");

    // 3. Spawn the CLI in --json mode
    let cli_path = admin_upgrade_cli_path();
    let mut child = std::process::Command::new("node")
        .arg(&cli_path)
        .args([
            "--json",
            "--panel-url",
            &admin_cfg.panel_url,
            "--p12-path",
            p12_path,
            "--output-p12",
            &output_p12_path.to_string_lossy(),
        ])
        .env("LAMALIBRE_LAMASTE_P12_PASS", p12_password)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn create-lamaste-admin: {}", e))?;

    // 4. Parse NDJSON output.
    //
    // The `complete` event carries `p12PasswordPath` — a 0600-mode file the
    // CLI wrote the new password into. The password value itself never crosses
    // stdout. We read the file below (same user that ran the CLI, no privilege
    // escalation needed) and hand it straight to the OS keychain.
    let stdout = child.stdout.take().ok_or("No stdout")?;
    let reader = std::io::BufReader::new(stdout);
    let mut new_p12_password_path: Option<String> = None;
    let mut last_error: Option<String> = None;

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Read error: {}", e))?;
        if line.trim().is_empty() {
            continue;
        }

        if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
            match event.get("event").and_then(|v| v.as_str()) {
                Some("complete") => {
                    if let Some(result) = event.get("result") {
                        new_p12_password_path = result
                            .get("p12PasswordPath")
                            .and_then(|v| v.as_str())
                            .map(String::from);
                    }
                }
                Some("error") => {
                    last_error =
                        event.get("message").and_then(|v| v.as_str()).map(String::from);
                }
                _ => {}
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait for process: {}", e))?;

    if !status.success() {
        return Err(last_error.unwrap_or_else(|| "Admin upgrade failed".to_string()));
    }

    let password_path = new_p12_password_path
        .ok_or("Upgrade completed but no P12 password path was returned")?;

    // Read the password file — owned by the current user (the CLI ran as us),
    // mode 0600. Trim trailing whitespace/newline.
    let new_password = std::fs::read_to_string(&password_path)
        .map_err(|e| format!("Failed to read P12 password file at {}: {}", password_path, e))?
        .trim()
        .to_string();
    if new_password.is_empty() {
        return Err(format!("P12 password file at {} is empty", password_path));
    }

    // 5. Store the new P12 password in the credential store
    credentials::store_admin_credential(server_id, &new_password)?;

    // 6. Update servers.json — keep P12 auth method with the new P12 path
    let registry_path = config::servers_registry_path();
    let content = std::fs::read_to_string(&registry_path)
        .map_err(|e| format!("Failed to read servers.json: {}", e))?;
    let mut servers: Vec<serde_json::Value> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse servers.json: {}", e))?;

    for server in servers.iter_mut() {
        if server.get("id").and_then(|v| v.as_str()) == Some(server_id) {
            server["adminAuth"] = serde_json::json!({
                "method": "p12",
                "p12Path": output_p12_path.to_string_lossy()
            });
            break;
        }
    }

    atomic_write_servers(&servers)?;

    Ok(())
}
