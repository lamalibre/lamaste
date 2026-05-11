// ============================================================================
// lamaste-desktop — daemon lifecycle management
// ============================================================================
//
// Manages local daemon start / stop / restart operations via the platform's
// service manager: launchd on macOS, systemd on Linux. Exposes a service-status
// query that tells the frontend whether a daemon is installed, loaded, and
// running — the information the LocalDaemonPill needs to display the correct
// indicator and context-menu actions.
//
// Three daemon kinds are supported:
//   - Agent:      lamaste-agentd on :9393
//   - Server:     lamaste-serverd on :3100 (local server installs)
//   - PluginHost: local plugin host on :9293

use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::branding::{ecosystem_bundle_id, ecosystem_unit};
use crate::config;

// ---------------------------------------------------------------------------
// Daemon kind enum
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DaemonKind {
    Agent,
    Server,
    PluginHost,
}

// ---------------------------------------------------------------------------
// Service metadata per daemon kind
// ---------------------------------------------------------------------------

struct ServiceMeta {
    /// launchd label / systemd unit prefix. Project-prefixed; computed from
    /// `config::project()`.
    label: String,
    /// HTTP health check path.
    health_path: &'static str,
    /// Base URL for the local HTTP health check.
    base_url: &'static str,
    /// systemd user unit name (Linux). Project-prefixed.
    systemd_unit: String,
}

fn meta_for(kind: &DaemonKind) -> ServiceMeta {
    let project = config::project();
    match kind {
        DaemonKind::Agent => ServiceMeta {
            label: format!("com.{}.agentd", project),
            health_path: "/api/status",
            base_url: "http://127.0.0.1:9393",
            systemd_unit: format!("{}-agentd.service", project),
        },
        DaemonKind::Server => ServiceMeta {
            label: format!("com.{}.serverd", project),
            health_path: "/api/health",
            base_url: "http://127.0.0.1:3100",
            systemd_unit: format!("{}-serverd.service", project),
        },
        DaemonKind::PluginHost => ServiceMeta {
            // Ecosystem-level: the local plugin host is shared across the machine
            // and not bound to any single product (lamaste/...) — uses ORG
            // namespace only. Must mirror localHostPlistLabel() /
            // localHostSystemdUnitName() in @lamalibre/lamaste/agent.
            label: ecosystem_bundle_id("local-plugin-host"),
            health_path: "/api/status",
            base_url: "http://127.0.0.1:9293",
            systemd_unit: format!("{}.service", ecosystem_unit("local-plugin-host")),
        },
    }
}

// ---------------------------------------------------------------------------
// Service file paths
// ---------------------------------------------------------------------------

fn home_dir() -> Option<PathBuf> {
    dirs::home_dir()
}

/// macOS plist path: ~/Library/LaunchAgents/<label>.plist
fn launchd_plist_path(label: &str) -> Option<PathBuf> {
    home_dir().map(|h| h.join("Library/LaunchAgents").join(format!("{label}.plist")))
}

/// Linux systemd user unit path: ~/.config/systemd/user/<unit>
fn systemd_unit_path(unit: &str) -> Option<PathBuf> {
    home_dir().map(|h| h.join(".config/systemd/user").join(unit))
}

// ---------------------------------------------------------------------------
// Service status
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DaemonServiceState {
    /// Service file is not installed on this machine.
    NotInstalled,
    /// Service file exists but the daemon process is not running.
    Stopped,
    /// The daemon process is running and responding to health checks.
    Running,
    /// The service file exists and may be loaded, but health check fails.
    /// The daemon could be starting up or crashed.
    Loaded,
    /// An error occurred while checking the status.
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonServiceStatus {
    pub state: DaemonServiceState,
    /// Whether the service file is present on disk.
    pub installed: bool,
    /// Platform: "darwin" or "linux".
    pub platform: String,
    /// The service file path (plist or unit), if applicable.
    pub service_path: Option<String>,
    /// Error message, if any.
    pub error: Option<String>,
}

fn is_darwin() -> bool {
    cfg!(target_os = "macos")
}

fn platform_str() -> String {
    if is_darwin() {
        "darwin".to_string()
    } else {
        "linux".to_string()
    }
}

/// Check if the service file exists on disk.
fn service_file_exists(kind: &DaemonKind) -> (bool, Option<String>) {
    let meta = meta_for(kind);
    if is_darwin() {
        if let Some(path) = launchd_plist_path(&meta.label) {
            let exists = path.exists();
            return (exists, Some(path.to_string_lossy().to_string()));
        }
    } else if let Some(path) = systemd_unit_path(&meta.systemd_unit) {
        let exists = path.exists();
        return (exists, Some(path.to_string_lossy().to_string()));
    }
    (false, None)
}

/// Check if a daemon is responding to HTTP health checks.
fn is_healthy(kind: &DaemonKind) -> bool {
    let meta = meta_for(kind);
    let url = format!(
        "{}/{}",
        meta.base_url.trim_end_matches('/'),
        meta.health_path.trim_start_matches('/')
    );
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    matches!(client.get(&url).send(), Ok(res) if res.status().is_success())
}

/// Check if the service is loaded on macOS via `launchctl list`.
fn is_launchd_loaded(label: &str) -> bool {
    Command::new("launchctl")
        .args(["list", label])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn get_service_status(kind: &DaemonKind) -> DaemonServiceStatus {
    let (installed, service_path) = service_file_exists(kind);

    if !installed {
        return DaemonServiceStatus {
            state: DaemonServiceState::NotInstalled,
            installed: false,
            platform: platform_str(),
            service_path,
            error: None,
        };
    }

    // Check if the daemon is actually responding
    if is_healthy(kind) {
        return DaemonServiceStatus {
            state: DaemonServiceState::Running,
            installed: true,
            platform: platform_str(),
            service_path,
            error: None,
        };
    }

    // On macOS, check if loaded (may be starting or crashed)
    if is_darwin() {
        let meta = meta_for(kind);
        if is_launchd_loaded(&meta.label) {
            return DaemonServiceStatus {
                state: DaemonServiceState::Loaded,
                installed: true,
                platform: platform_str(),
                service_path,
                error: None,
            };
        }
    }

    DaemonServiceStatus {
        state: DaemonServiceState::Stopped,
        installed: true,
        platform: platform_str(),
        service_path,
        error: None,
    }
}

// ---------------------------------------------------------------------------
// Lifecycle operations
// ---------------------------------------------------------------------------

/// Get the launchd domain target for the current user (e.g. `gui/501`).
fn launchd_domain() -> String {
    let uid = unsafe { libc::getuid() };
    format!("gui/{uid}")
}

fn start_service(kind: &DaemonKind) -> Result<(), String> {
    let meta = meta_for(kind);
    if is_darwin() {
        let plist = launchd_plist_path(&meta.label)
            .ok_or("cannot determine plist path")?;
        if !plist.exists() {
            return Err(format!(
                "service file not found: {}",
                plist.to_string_lossy()
            ));
        }
        let domain = launchd_domain();
        let plist_str = plist.to_string_lossy().to_string();
        // Bootstrap into the user domain (modern launchctl API)
        let output = Command::new("launchctl")
            .args(["bootstrap", &domain, &plist_str])
            .output()
            .map_err(|e| format!("launchctl bootstrap failed: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // Already bootstrapped is fine
            if !stderr.contains("already bootstrapped")
                && !stderr.contains("service already loaded")
            {
                return Err(format!("launchctl bootstrap: {}", stderr.trim()));
            }
        }
        // Enable the service so it survives reboots
        let target = format!("{domain}/{}", meta.label);
        let _ = Command::new("launchctl")
            .args(["enable", &target])
            .output();
    } else {
        let output = Command::new("systemctl")
            .args(["--user", "start", &meta.systemd_unit])
            .output()
            .map_err(|e| format!("systemctl start failed: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("systemctl start: {}", stderr.trim()));
        }
    }
    Ok(())
}

fn stop_service(kind: &DaemonKind) -> Result<(), String> {
    let meta = meta_for(kind);
    if is_darwin() {
        let plist = launchd_plist_path(&meta.label)
            .ok_or("cannot determine plist path")?;
        let domain = launchd_domain();
        let plist_str = plist.to_string_lossy().to_string();
        // Bootout from the user domain (modern launchctl API)
        let output = Command::new("launchctl")
            .args(["bootout", &domain, &plist_str])
            .output()
            .map_err(|e| format!("launchctl bootout failed: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // Not loaded is fine — idempotent stop
            if !stderr.contains("Could not find")
                && !stderr.contains("not loaded")
                && !stderr.contains("No such process")
            {
                return Err(format!("launchctl bootout: {}", stderr.trim()));
            }
        }
    } else {
        let output = Command::new("systemctl")
            .args(["--user", "stop", &meta.systemd_unit])
            .output()
            .map_err(|e| format!("systemctl stop failed: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stderr.contains("not loaded") && !stderr.contains("not found") {
                return Err(format!("systemctl stop: {}", stderr.trim()));
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/// Feria registry URL for `@lamalibre/*` packages during install.
const FERIA_REGISTRY: &str = "http://127.0.0.1:4873";

/// Install a daemon by spawning the appropriate installer.
///
/// Agent and Server delegate to their npx `create-*` installers, which emit
/// their own NDJSON progress. PluginHost is installed directly by this
/// process because there is no per-server enrollment — see `install_plugin_host`.
///
/// NDJSON progress lines are emitted as Tauri events for the frontend.
fn install_daemon(
    app_handle: &tauri::AppHandle,
    kind: &DaemonKind,
) -> Result<(), String> {
    use std::io::BufRead;
    use tauri::Emitter;

    // PluginHost takes a dedicated code path — there is no create-* wrapper for it.
    if matches!(kind, DaemonKind::PluginHost) {
        return install_plugin_host(app_handle);
    }

    let (args, event_name): (Vec<&str>, String) = match kind {
        DaemonKind::Agent => (
            vec![
                "--registry", FERIA_REGISTRY,
                "@lamalibre/create-lamaste-agent",
                "--headless",
                "--json",
            ],
            "daemon:install-progress:agent".to_string(),
        ),
        DaemonKind::Server => (
            vec![
                "--registry", FERIA_REGISTRY,
                "@lamalibre/create-lamaste",
                "--json",
            ],
            "daemon:install-progress:server".to_string(),
        ),
        DaemonKind::PluginHost => unreachable!("handled above"),
    };

    let mut child = Command::new("npx")
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("npx installer failed to start: {e}"))?;

    // Stream stdout NDJSON lines as Tauri events for real-time progress
    if let Some(stdout) = child.stdout.take() {
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
                let _ = app_handle.emit(&event_name, parsed);
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("failed to wait for installer: {e}"))?;

    if !status.success() {
        let stderr_output = if let Some(mut stderr) = child.stderr.take() {
            let mut buf = String::new();
            let _ = std::io::Read::read_to_string(&mut stderr, &mut buf);
            buf
        } else {
            String::new()
        };
        let detail = stderr_output.trim();
        return Err(if detail.is_empty() {
            format!("installer exited with status {status}")
        } else {
            format!("installer failed:\n{detail}")
        });
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// PluginHost install (dedicated flow)
// ---------------------------------------------------------------------------

const PLUGIN_HOST_PACKAGE: &str = "@lamalibre/local-plugin-hostd";
const PLUGIN_HOST_BIN_NAME: &str = "lamalibre-local-plugin-hostd";
const PLUGIN_HOST_EVENT: &str = "daemon:install-progress:pluginHost";
const PLUGIN_HOST_PORT: u16 = 9293;
const HEALTHCHECK_DEADLINE_SECS: u64 = 15;

fn emit_event(app: &tauri::AppHandle, payload: serde_json::Value) {
    use tauri::Emitter;
    let _ = app.emit(PLUGIN_HOST_EVENT, payload);
}

fn emit_step_start(app: &tauri::AppHandle, name: &str) {
    emit_event(
        app,
        serde_json::json!({ "event": "step", "status": "start", "name": name }),
    );
}

fn emit_step_complete(app: &tauri::AppHandle, name: &str) {
    emit_event(
        app,
        serde_json::json!({ "event": "step", "status": "complete", "name": name }),
    );
}

fn node_binary() -> String {
    std::env::var("LAMALIBRE_NODE_BIN").unwrap_or_else(|_| "node".to_string())
}

fn npm_binary() -> String {
    std::env::var("LAMALIBRE_NPM_BIN").unwrap_or_else(|_| "npm".to_string())
}

/// Run a command and collect trimmed stdout on success, or propagate a
/// stderr-tinted error on failure.
fn run_capturing(cmd: &mut Command, label: &str) -> Result<String, String> {
    let output = cmd
        .output()
        .map_err(|e| format!("{label} failed to start: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(if detail.is_empty() {
            format!("{label} exited with status {}", output.status)
        } else {
            format!("{label} failed: {detail}")
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Resolve the absolute path of the installed plugin-host bin file.
///
/// Resolves through `npm root -g` rather than relying on a PATH lookup —
/// the plist needs a stable absolute path, and npm bin shims may not be on
/// launchd's PATH on macOS.
fn resolve_plugin_host_entry() -> Result<PathBuf, String> {
    let npm_root = run_capturing(
        Command::new(npm_binary()).args(["root", "-g"]),
        "npm root -g",
    )?;
    let candidate = PathBuf::from(npm_root)
        .join(PLUGIN_HOST_PACKAGE)
        .join("bin")
        .join(format!("{PLUGIN_HOST_BIN_NAME}.js"));
    if !candidate.exists() {
        return Err(format!(
            "plugin host entry not found at {}",
            candidate.display()
        ));
    }
    Ok(candidate)
}

/// Install the local plugin host: npm install, write service config, bootstrap
/// the service, and healthcheck. Rollback on failure.
fn install_plugin_host(app: &tauri::AppHandle) -> Result<(), String> {
    // 0. Detection
    let node_version = run_capturing(
        Command::new(node_binary()).arg("--version"),
        "node --version",
    )
    .unwrap_or_else(|_| "unknown".into());
    emit_event(
        app,
        serde_json::json!({
            "event": "detection",
            "data": {
                "os": if is_darwin() { "darwin" } else { "linux" },
                "arch": std::env::consts::ARCH,
                "nodeVersion": node_version,
            }
        }),
    );

    // 1. npm install -g (via Feria during dev, npmjs.org after ship)
    emit_step_start(app, "npm-install");
    run_capturing(
        Command::new(npm_binary()).args([
            "install",
            "-g",
            "--registry",
            FERIA_REGISTRY,
            PLUGIN_HOST_PACKAGE,
        ]),
        "npm install",
    )?;
    emit_step_complete(app, "npm-install");

    // 2. Resolve the absolute entry path
    emit_step_start(app, "resolve-entry");
    let entry_path = resolve_plugin_host_entry()?;
    emit_step_complete(app, "resolve-entry");

    // 3. Write the service config (plist / systemd unit)
    emit_step_start(app, "write-service-config");
    run_capturing(
        Command::new(node_binary()).args([
            entry_path.to_string_lossy().as_ref(),
            "--write-service-config",
            "--port",
            &PLUGIN_HOST_PORT.to_string(),
        ]),
        "write-service-config",
    )
    .map_err(|e| {
        // No state to roll back yet — the config hasn't been written if this failed.
        emit_event(
            app,
            serde_json::json!({ "event": "done", "status": "failed", "message": e }),
        );
        e
    })?;
    emit_step_complete(app, "write-service-config");

    // 4. Load the service
    emit_step_start(app, "load-service");
    if let Err(e) = start_service(&DaemonKind::PluginHost) {
        // Rollback the service config so the stale plist/unit does not linger.
        let _ = Command::new(node_binary())
            .args([
                entry_path.to_string_lossy().as_ref(),
                "--remove-service-config",
            ])
            .output();
        emit_event(
            app,
            serde_json::json!({ "event": "done", "status": "failed", "message": e }),
        );
        return Err(e);
    }
    emit_step_complete(app, "load-service");

    // 5. Healthcheck — poll /api/status until 200 or deadline
    emit_step_start(app, "healthcheck");
    let deadline = std::time::Instant::now() + Duration::from_secs(HEALTHCHECK_DEADLINE_SECS);
    let mut healthy = false;
    while std::time::Instant::now() < deadline {
        if is_healthy(&DaemonKind::PluginHost) {
            healthy = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    if !healthy {
        let msg = format!(
            "plugin host did not respond on http://127.0.0.1:{PLUGIN_HOST_PORT}/api/status within {HEALTHCHECK_DEADLINE_SECS}s",
        );
        let _ = stop_service(&DaemonKind::PluginHost);
        let _ = Command::new(node_binary())
            .args([
                entry_path.to_string_lossy().as_ref(),
                "--remove-service-config",
            ])
            .output();
        emit_event(
            app,
            serde_json::json!({ "event": "done", "status": "failed", "message": msg }),
        );
        return Err(msg);
    }
    emit_step_complete(app, "healthcheck");

    emit_event(app, serde_json::json!({ "event": "summary" }));
    Ok(())
}

/// Data directory for a daemon kind.
fn data_dir(kind: &DaemonKind) -> Option<PathBuf> {
    let root = config::agent_dir();
    Some(match kind {
        DaemonKind::Agent => root,
        DaemonKind::Server => root.join("server"),
        DaemonKind::PluginHost => root.join("local"),
    })
}

// ---------------------------------------------------------------------------
// Uninstall
// ---------------------------------------------------------------------------

fn uninstall_daemon(kind: &DaemonKind, remove_data: bool) -> Result<(), String> {
    // 1. Stop the service (best-effort)
    let _ = stop_service(kind);
    std::thread::sleep(Duration::from_millis(500));

    // 2. Remove the service file
    let (exists, service_path) = service_file_exists(kind);
    if exists {
        if let Some(ref path_str) = service_path {
            let path = PathBuf::from(path_str);
            std::fs::remove_file(&path)
                .map_err(|e| format!("failed to remove service file {}: {e}", path.display()))?;
        }
    }

    // On Linux, reload systemd after removing the unit
    if !is_darwin() {
        let _ = Command::new("systemctl")
            .args(["--user", "daemon-reload"])
            .output();
    }

    // 3. Remove data directory if requested
    if remove_data {
        if let Some(dir) = data_dir(kind) {
            if dir.exists() {
                std::fs::remove_dir_all(&dir)
                    .map_err(|e| format!("failed to remove data dir {}: {e}", dir.display()))?;
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Cross-module helpers
// ---------------------------------------------------------------------------

/// Restart the local plugin host: stop, then start, then wait briefly for
/// the daemon to come up. Callers that mutate the plugin registry (install,
/// enable, uninstall, update) invoke this so Fastify re-mounts plugin routes.
pub(crate) fn restart_plugin_host() -> Result<(), String> {
    let _ = stop_service(&DaemonKind::PluginHost);
    std::thread::sleep(Duration::from_millis(500));
    start_service(&DaemonKind::PluginHost)?;
    // Wait for /api/status to respond — bounded to avoid hanging the UI.
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while std::time::Instant::now() < deadline {
        if is_healthy(&DaemonKind::PluginHost) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Err("plugin host did not respond after restart".into())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn daemon_get_service_status(
    kind: DaemonKind,
) -> Result<DaemonServiceStatus, String> {
    tokio::task::spawn_blocking(move || Ok(get_service_status(&kind)))
        .await
        .map_err(|e| format!("spawn_blocking: {e}"))?
}

#[tauri::command]
pub async fn daemon_start(
    kind: DaemonKind,
) -> Result<DaemonServiceStatus, String> {
    let k = kind.clone();
    tokio::task::spawn_blocking(move || {
        start_service(&k)?;
        Ok(get_service_status(&k))
    })
    .await
    .map_err(|e| format!("spawn_blocking: {e}"))?
}

#[tauri::command]
pub async fn daemon_stop(
    kind: DaemonKind,
) -> Result<DaemonServiceStatus, String> {
    let k = kind.clone();
    tokio::task::spawn_blocking(move || {
        stop_service(&k)?;
        Ok(get_service_status(&k))
    })
    .await
    .map_err(|e| format!("spawn_blocking: {e}"))?
}

#[tauri::command]
pub async fn daemon_restart(
    kind: DaemonKind,
) -> Result<DaemonServiceStatus, String> {
    let k = kind.clone();
    tokio::task::spawn_blocking(move || {
        // Stop is best-effort — if it fails, still try to start
        let _ = stop_service(&k);
        // Brief pause to let the process exit
        std::thread::sleep(Duration::from_millis(500));
        start_service(&k)?;
        // Wait a moment for the daemon to come up before checking status
        std::thread::sleep(Duration::from_secs(1));
        Ok(get_service_status(&k))
    })
    .await
    .map_err(|e| format!("spawn_blocking: {e}"))?
}

#[tauri::command]
pub async fn daemon_install(
    app: tauri::AppHandle,
    kind: DaemonKind,
) -> Result<DaemonServiceStatus, String> {
    let k = kind.clone();
    let app_handle = app.clone();
    tokio::task::spawn_blocking(move || {
        install_daemon(&app_handle, &k)?;
        Ok(get_service_status(&k))
    })
    .await
    .map_err(|e| format!("spawn_blocking: {e}"))?
}

#[tauri::command]
pub async fn daemon_uninstall(
    kind: DaemonKind,
    remove_data: bool,
) -> Result<DaemonServiceStatus, String> {
    let k = kind.clone();
    tokio::task::spawn_blocking(move || {
        uninstall_daemon(&k, remove_data)?;
        Ok(get_service_status(&k))
    })
    .await
    .map_err(|e| format!("spawn_blocking: {e}"))?
}
