/// Local server installation Tauri commands.
///
/// These commands allow the desktop app to install a Portlama server directly
/// on the local Linux machine using `pkexec` for privilege escalation and the
/// `create-portlama` installer in `--json` (NDJSON) mode.
use crate::cloud::{self, ServerEntry};
use crate::config;
use crate::credentials;

use serde::{Deserialize, Serialize};
use std::io::BufRead;
use std::path::PathBuf;
use tauri::Emitter;

/// Maximum bytes per NDJSON line (64 KB). Lines exceeding this are skipped
/// to prevent memory exhaustion from a misbehaving child process.
const MAX_LINE_BYTES: usize = 65_536;

/// Only paths under this prefix are accepted from the NDJSON output.
const ALLOWED_PKI_PREFIX: &str = "/etc/portlama/pki/";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalInstallStatus {
    pub platform: String,
    pub available: bool,
    pub reason: Option<String>,
    pub existing_install: bool,
    pub already_in_registry: bool,
}

/// NDJSON progress line emitted by `create-portlama --json`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallProgress {
    event: String,
    step: Option<String>,
    status: Option<String>,
    message: Option<String>,
    server: Option<InstallServerInfo>,
    #[allow(dead_code)]
    recoverable: Option<bool>,
}

/// Server info returned in the NDJSON "complete" event.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallServerInfo {
    ip: String,
    #[allow(dead_code)]
    panel_url: String,
    p12_path: String,
    p12_password_path: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Resolve the path to the create-portlama CLI entry point.
/// In dev builds, uses the workspace path (CARGO_MANIFEST_DIR baked at compile time).
/// In release builds, resolves via `which` before privilege escalation rather than
/// relying on root's PATH.
fn create_portlama_cli_path() -> Result<PathBuf, String> {
    // Dev: workspace-relative path (only in debug builds to avoid leaking
    // the developer's filesystem layout into release binaries)
    #[cfg(debug_assertions)]
    {
        let workspace_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../create-portlama/bin/create-portlama.js");
        if let Ok(canonical) = workspace_path.canonicalize() {
            if canonical.exists() {
                return Ok(canonical);
            }
        }
    }

    // Release: resolve absolute path via which (before pkexec escalation)
    let output = std::process::Command::new("which")
        .arg("create-portlama")
        .output()
        .map_err(|e| format!("Failed to locate create-portlama: {}", e))?;

    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            return Ok(PathBuf::from(path));
        }
    }

    Err("create-portlama not found. Install it with: npm install -g @lamalibre/create-portlama".to_string())
}

/// Validate that a path from NDJSON output is within the allowed PKI directory.
/// Rejects path traversal (`..`), paths outside `/etc/portlama/pki/`, and
/// symlinks that resolve outside the allowed prefix.
fn validate_pki_path(path: &str) -> Result<(), String> {
    if path.contains("..") {
        return Err(format!("Path contains traversal component: {}", path));
    }
    if !path.starts_with(ALLOWED_PKI_PREFIX) {
        return Err(format!("Path {} is outside {}", path, ALLOWED_PKI_PREFIX));
    }
    // Resolve symlinks and re-verify the canonical path is still within the prefix.
    // This prevents symlink-based escapes (e.g., /etc/portlama/pki/link -> /etc/shadow).
    if let Ok(canonical) = std::fs::canonicalize(path) {
        let canonical_str = canonical.to_string_lossy();
        if !canonical_str.starts_with(ALLOWED_PKI_PREFIX) {
            return Err(format!(
                "Path {} resolves to {} which is outside {}",
                path,
                canonical_str,
                ALLOWED_PKI_PREFIX,
            ));
        }
    }
    // If canonicalize fails (file doesn't exist yet), the string check above is sufficient
    Ok(())
}

/// Get the current user's UID as a string for chown operations.
/// Uses the real UID (not the environment variable) to prevent manipulation.
fn current_uid() -> String {
    #[cfg(unix)]
    {
        unsafe { libc::getuid() }.to_string()
    }
    #[cfg(not(unix))]
    {
        "1000".to_string()
    }
}

/// Check if a local server entry already exists in the registry.
fn has_local_server(servers: &[ServerEntry]) -> bool {
    servers
        .iter()
        .any(|s| s.provider.as_deref() == Some("local"))
}

/// Import P12 certificate from the server-side PKI directory into the user's
/// `~/.portlama/servers/<id>/` directory using `pkexec` for root file access.
/// Stores the P12 password in the OS credential store.
/// Returns the destination P12 file path.
fn import_local_certs(
    server_id: &str,
    p12_path: &str,
    p12_password_path: &str,
) -> Result<String, String> {
    // Validate paths are within the expected PKI directory
    validate_pki_path(p12_path)?;
    validate_pki_path(p12_password_path)?;

    let dest_dir = config::agent_dir().join("servers").join(server_id);
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create server directory: {}", e))?;

    // Set directory permissions to 0700 (contains credential files)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dest_dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("Failed to set directory permissions: {}", e))?;
    }

    let dest_p12 = dest_dir.join("admin.p12");
    let dest_p12_str = dest_p12
        .to_str()
        .ok_or("Invalid P12 dest path")?
        .to_string();

    // Read P12 password (root-owned file) via pkexec
    let pw_output = std::process::Command::new("pkexec")
        .args(["cat", p12_password_path])
        .output()
        .map_err(|_| "Failed to read P12 password".to_string())?;

    if !pw_output.status.success() {
        return Err("Failed to read P12 password".to_string());
    }
    let password = String::from_utf8_lossy(&pw_output.stdout)
        .trim()
        .to_string();

    // Copy P12 file (root-owned) via pkexec cp, then chown to current user
    let cp_status = std::process::Command::new("pkexec")
        .args(["cp", p12_path, &dest_p12_str])
        .status()
        .map_err(|_| "Failed to copy P12 file".to_string())?;

    if !cp_status.success() {
        return Err("Failed to copy P12 file".to_string());
    }

    // chown to current user's UID (not the $USER env var) so we can read without root
    let uid = current_uid();
    let chown_status = std::process::Command::new("pkexec")
        .args(["chown", &uid, &dest_p12_str])
        .status()
        .map_err(|_| "Failed to chown P12 file".to_string())?;

    if !chown_status.success() {
        // Cleanup: remove the root-owned copy since we can't use it
        let _ = std::process::Command::new("pkexec")
            .args(["rm", &dest_p12_str])
            .status();
        return Err("Failed to chown P12 file".to_string());
    }

    // Set restrictive permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dest_p12, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Failed to set P12 permissions: {}", e))?;
    }

    // Store password in OS credential store, then drop it
    credentials::store_server_credential(server_id, &password)?;

    Ok(dest_p12_str)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Check whether local installation is available on this platform.
#[tauri::command]
pub async fn check_local_install_available() -> Result<LocalInstallStatus, String> {
    tokio::task::spawn_blocking(|| {
        let platform = if cfg!(target_os = "macos") {
            "macos"
        } else if cfg!(target_os = "linux") {
            "linux"
        } else {
            "other"
        };

        // On non-Linux platforms, local install is not available
        if platform != "linux" {
            return Ok(LocalInstallStatus {
                platform: platform.to_string(),
                available: false,
                reason: Some(
                    "Local installation is only available on Linux (Ubuntu 24.04)".to_string(),
                ),
                existing_install: false,
                already_in_registry: false,
            });
        }

        // Check for pkexec
        let pkexec_available = std::process::Command::new("which")
            .arg("pkexec")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if !pkexec_available {
            return Ok(LocalInstallStatus {
                platform: platform.to_string(),
                available: false,
                reason: Some(
                    "pkexec is required for local installation. Install it with: sudo apt install policykit-1".to_string(),
                ),
                existing_install: false,
                already_in_registry: false,
            });
        }

        // Check for existing installation
        let existing_install = std::path::Path::new("/etc/portlama/panel.json").exists();

        // Check if a local server is already in the registry
        let already_in_registry = cloud::load_servers_registry()
            .map(|servers| has_local_server(&servers))
            .unwrap_or(false);

        Ok(LocalInstallStatus {
            platform: platform.to_string(),
            available: true,
            reason: None,
            existing_install,
            already_in_registry,
        })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Install a Portlama server on the local machine via pkexec + create-portlama --json.
/// Streams NDJSON progress as `local-install-progress` Tauri events.
#[tauri::command]
pub async fn start_local_install(
    app_handle: tauri::AppHandle,
    label: String,
    skip_harden: bool,
) -> Result<ServerEntry, String> {
    cloud::validate_label(&label)?;

    let app = app_handle.clone();

    tokio::task::spawn_blocking(move || {
        // Verify no existing local server in registry
        if cloud::load_servers_registry()
            .map(|s| has_local_server(&s))
            .unwrap_or(false)
        {
            return Err(
                "A local server is already registered. Only one local server is allowed."
                    .to_string(),
            );
        }

        // Resolve CLI path before escalation (not under root's PATH)
        let cli_path = create_portlama_cli_path()?;

        // Build arguments — --json implies --yes and --dev, but we pass them
        // explicitly for robustness against future changes to the implication logic
        let mut args: Vec<String> = vec![
            cli_path.to_string_lossy().to_string(),
            "--json".to_string(),
            "--yes".to_string(),
            "--dev".to_string(),
        ];
        if skip_harden {
            args.push("--skip-harden".to_string());
        }

        // Spawn via pkexec for root access.
        // stderr is inherited to avoid deadlock from a full pipe buffer.
        let mut child = std::process::Command::new("pkexec")
            .arg("node")
            .args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Failed to start local install: {}", e))?;

        // Read NDJSON progress from stdout with bounded line length
        let stdout = child.stdout.take().ok_or("No stdout")?;
        let mut reader = std::io::BufReader::new(stdout);
        let mut last_server: Option<InstallServerInfo> = None;
        let mut last_error: Option<String> = None;
        let mut line_buf = String::new();

        loop {
            line_buf.clear();
            let n = reader
                .read_line(&mut line_buf)
                .map_err(|e| format!("Read error: {}", e))?;
            if n == 0 {
                break; // EOF
            }
            if n > MAX_LINE_BYTES {
                continue; // Skip oversized lines
            }
            let line = line_buf.trim();
            if line.is_empty() {
                continue;
            }

            if let Ok(progress) = serde_json::from_str::<InstallProgress>(line) {
                match progress.event.as_str() {
                    "complete" => {
                        last_server = progress.server;
                    }
                    "error" => {
                        last_error = progress.message.clone();
                        // Emit error with step if available, otherwise with
                        // a generic "install" step so the frontend can show the X
                        let step_key = progress
                            .step
                            .as_deref()
                            .unwrap_or("deploy_panel");
                        let _ = app.emit(
                            "local-install-progress",
                            serde_json::json!({
                                "step": step_key,
                                "status": "failed",
                            }),
                        );
                    }
                    "step" => {
                        if let (Some(ref step), Some(ref status)) =
                            (&progress.step, &progress.status)
                        {
                            let _ = app.emit(
                                "local-install-progress",
                                serde_json::json!({
                                    "step": step,
                                    "status": status,
                                }),
                            );
                        }
                    }
                    _ => {}
                }
            }
        }

        let status = child
            .wait()
            .map_err(|e| format!("Failed to wait for installer: {}", e))?;

        if !status.success() {
            if let Some(err) = last_error {
                return Err(format!("Installation failed: {}", err));
            }
            // Check for pkexec-specific exit codes
            let code = status.code().unwrap_or(-1);
            if code == 126 || code == 127 {
                return Err(
                    "Installation cancelled or pkexec authorization failed".to_string(),
                );
            }
            return Err("Installation failed".to_string());
        }

        let server_info =
            last_server.ok_or("Installation completed but no server info returned")?;

        // Post-install: import certificates
        let _ = app.emit(
            "local-install-progress",
            serde_json::json!({
                "step": "import_certs",
                "status": "running",
            }),
        );

        let server_id = uuid::Uuid::new_v4().to_string();
        let p12_dest = import_local_certs(
            &server_id,
            &server_info.p12_path,
            &server_info.p12_password_path,
        )?;

        let _ = app.emit(
            "local-install-progress",
            serde_json::json!({
                "step": "import_certs",
                "status": "complete",
            }),
        );

        // Save to registry — reload fresh to avoid TOCTOU with concurrent modifications
        let _ = app.emit(
            "local-install-progress",
            serde_json::json!({
                "step": "save_registry",
                "status": "running",
            }),
        );

        let mut servers = cloud::load_servers_registry().unwrap_or_default();
        if has_local_server(&servers) {
            return Err(
                "A local server was registered during installation".to_string(),
            );
        }

        // Deactivate all existing servers
        for s in servers.iter_mut() {
            s.active = false;
        }

        let entry = ServerEntry {
            id: server_id,
            label,
            panel_url: format!("https://{}:9292", server_info.ip),
            ip: server_info.ip,
            domain: None,
            provider: Some("local".to_string()),
            provider_id: None,
            region: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            active: true,
            auth_method: "p12".to_string(),
            keychain_identity: None,
            p12_path: Some(p12_dest),
            p12_password: None,
        };

        servers.push(entry.clone());
        cloud::save_servers_registry(&config::servers_registry_path(), &servers)?;

        let _ = app.emit(
            "local-install-progress",
            serde_json::json!({
                "step": "save_registry",
                "status": "complete",
            }),
        );

        Ok(entry)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Import an existing local Portlama installation into the server registry
/// without running the installer. Used when /etc/portlama/panel.json exists
/// but no local server is in servers.json.
#[tauri::command]
pub async fn import_existing_local_install(
    app_handle: tauri::AppHandle,
    label: String,
) -> Result<ServerEntry, String> {
    cloud::validate_label(&label)?;

    let app = app_handle.clone();

    tokio::task::spawn_blocking(move || {
        // Verify existing installation
        if !std::path::Path::new("/etc/portlama/panel.json").exists() {
            return Err(
                "No existing Portlama installation found at /etc/portlama/panel.json".to_string(),
            );
        }

        let mut servers = cloud::load_servers_registry().unwrap_or_default();
        if has_local_server(&servers) {
            return Err("A local server is already registered".to_string());
        }

        let _ = app.emit(
            "local-install-progress",
            serde_json::json!({
                "step": "import_certs",
                "status": "running",
            }),
        );

        let server_id = uuid::Uuid::new_v4().to_string();
        let p12_dest = import_local_certs(
            &server_id,
            "/etc/portlama/pki/client.p12",
            "/etc/portlama/pki/.p12-password",
        )?;

        let _ = app.emit(
            "local-install-progress",
            serde_json::json!({
                "step": "import_certs",
                "status": "complete",
            }),
        );

        let _ = app.emit(
            "local-install-progress",
            serde_json::json!({
                "step": "save_registry",
                "status": "running",
            }),
        );

        // Deactivate all existing servers
        for s in servers.iter_mut() {
            s.active = false;
        }

        let entry = ServerEntry {
            id: server_id,
            label,
            panel_url: "https://127.0.0.1:9292".to_string(),
            ip: "127.0.0.1".to_string(),
            domain: None,
            provider: Some("local".to_string()),
            provider_id: None,
            region: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            active: true,
            auth_method: "p12".to_string(),
            keychain_identity: None,
            p12_path: Some(p12_dest),
            p12_password: None,
        };

        servers.push(entry.clone());
        cloud::save_servers_registry(&config::servers_registry_path(), &servers)?;

        let _ = app.emit(
            "local-install-progress",
            serde_json::json!({
                "step": "save_registry",
                "status": "complete",
            }),
        );

        Ok(entry)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Check health of the local Portlama server at https://127.0.0.1:9292.
#[tauri::command]
pub async fn check_local_server_health() -> Result<cloud::ServerHealth, String> {
    tokio::task::spawn_blocking(|| {
        let output = std::process::Command::new("curl")
            .args([
                "-sk",
                "--max-time",
                "5",
                "https://127.0.0.1:9292/api/health",
            ])
            .output()
            .map_err(|e| format!("Health check failed: {}", e))?;

        if !output.status.success() {
            return Ok(cloud::ServerHealth {
                online: false,
                status: Some("unreachable".to_string()),
            });
        }

        // Parse JSON response for robust status detection
        let body = String::from_utf8_lossy(&output.stdout);
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(body.trim()) {
            let status_str = json
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            Ok(cloud::ServerHealth {
                online: true,
                status: Some(status_str.to_string()),
            })
        } else {
            Ok(cloud::ServerHealth {
                online: true,
                status: Some(body.trim().to_string()),
            })
        }
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}
