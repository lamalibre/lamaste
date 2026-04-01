use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::Emitter;

use crate::config;

/// Maximum bytes per NDJSON line (DoS protection).
const MAX_LINE_BYTES: usize = 65_536;

/// Guard against concurrent installations for the same label.
static INSTALLING_LABELS: std::sync::LazyLock<Mutex<HashSet<String>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashSet::new()));

/// Agent entry in the multi-agent registry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEntry {
    pub label: String,
    pub panel_url: String,
    #[serde(default = "default_auth_method")]
    pub auth_method: String,
    #[serde(default)]
    pub p12_path: Option<String>,
    #[serde(default, skip_serializing)]
    pub p12_password: Option<String>,
    #[serde(default)]
    pub keychain_identity: Option<String>,
    #[serde(default)]
    pub agent_label: Option<String>,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub chisel_version: Option<String>,
    #[serde(default)]
    pub setup_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

/// The multi-agent registry file structure.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsRegistry {
    pub version: u32,
    pub current_label: Option<String>,
    pub agents: Vec<AgentEntry>,
}

/// Agent entry with live status information.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWithStatus {
    pub label: String,
    pub panel_url: String,
    pub auth_method: String,
    pub domain: Option<String>,
    pub chisel_version: Option<String>,
    pub setup_at: Option<String>,
    pub updated_at: Option<String>,
    pub running: bool,
    pub pid: Option<u32>,
}

fn default_auth_method() -> String {
    "p12".to_string()
}

/// Path to the agents registry file.
pub fn agents_registry_path() -> PathBuf {
    config::agent_dir().join("agents.json")
}

/// Per-agent data directory.
pub fn agent_data_dir(label: &str) -> PathBuf {
    config::agent_dir().join("agents").join(label)
}

/// Per-agent log file path.
pub fn agent_log_file(label: &str) -> PathBuf {
    agent_data_dir(label).join("logs").join("chisel.log")
}

/// Per-agent error log file path.
pub fn agent_error_log_file(label: &str) -> PathBuf {
    agent_data_dir(label).join("logs").join("chisel.error.log")
}

/// Per-agent launchd plist label.
pub fn plist_label_for(label: &str) -> String {
    format!("com.portlama.chisel-{}", label)
}

/// Per-agent launchd plist file path.
#[cfg(target_os = "macos")]
pub fn plist_path_for(label: &str) -> PathBuf {
    dirs::home_dir()
        .expect("Could not determine home directory")
        .join("Library/LaunchAgents")
        .join(format!("{}.plist", plist_label_for(label)))
}

/// Per-agent systemd unit name.
#[cfg(target_os = "linux")]
pub fn systemd_unit_name(label: &str) -> String {
    format!("portlama-chisel-{}", label)
}

/// Validate an agent label.
/// Lowercase alphanumeric + hyphens, 1-63 chars, must start/end with alnum.
pub fn validate_agent_label(label: &str) -> Result<(), String> {
    if label.is_empty() || label.len() > 63 {
        return Err("Agent label must be 1-63 characters".to_string());
    }
    let bytes = label.as_bytes();
    let is_alnum = |b: u8| b.is_ascii_lowercase() || b.is_ascii_digit();
    if !is_alnum(bytes[0]) || (bytes.len() > 1 && !is_alnum(bytes[bytes.len() - 1])) {
        return Err(
            "Agent label must start and end with a lowercase letter or number".to_string(),
        );
    }
    if !label.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        return Err(
            "Agent label must contain only lowercase letters, numbers, and hyphens".to_string(),
        );
    }
    if label.contains("..") || label.contains('/') || label.contains('\\') {
        return Err("Agent label contains forbidden characters".to_string());
    }
    Ok(())
}

/// Load the agents registry from disk.
pub fn load_agents_registry() -> Result<Option<AgentsRegistry>, String> {
    let path = agents_registry_path();
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read agents.json: {}", e))?;
    let registry: AgentsRegistry = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse agents.json: {}", e))?;
    Ok(Some(registry))
}

/// Save the agents registry atomically.
pub fn save_agents_registry(registry: &AgentsRegistry) -> Result<(), String> {
    let path = agents_registry_path();
    let dir = path.parent().unwrap();
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    let json = serde_json::to_string_pretty(registry)
        .map_err(|e| format!("Failed to serialize agents registry: {}", e))?;

    let tmp_path = path.with_extension("json.tmp");

    {
        let mut file = std::fs::File::create(&tmp_path)
            .map_err(|e| format!("Failed to create temp registry: {}", e))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("Failed to write temp registry: {}", e))?;
        file.write_all(b"\n")
            .map_err(|e| format!("Failed to write trailing newline: {}", e))?;
        file.sync_all()
            .map_err(|e| format!("Failed to fsync temp registry: {}", e))?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Failed to set registry permissions: {}", e))?;
    }

    std::fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to save agents registry: {}", e))?;

    Ok(())
}

/// Check if a specific agent's chisel service is running.
pub fn get_agent_chisel_status(label: &str) -> (bool, Option<u32>) {
    #[cfg(target_os = "macos")]
    {
        get_agent_launchctl_status(label)
    }
    #[cfg(target_os = "linux")]
    {
        get_agent_systemd_status(label)
    }
}

#[cfg(target_os = "macos")]
fn get_agent_launchctl_status(label: &str) -> (bool, Option<u32>) {
    let plist_label = plist_label_for(label);
    // Use `launchctl list` (no args) and match the exact label in the third column
    // to avoid false positives from prefix matching and to get the PID from the
    // tab-separated output format: "PID\tStatus\tLabel"
    let output = Command::new("launchctl")
        .arg("list")
        .output();

    match output {
        Ok(o) if o.status.success() => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            for line in stdout.lines() {
                let cols: Vec<&str> = line.split('\t').collect();
                if cols.len() >= 3 && cols[2] == plist_label {
                    let pid = cols[0].trim().parse::<u32>().ok();
                    return (true, pid);
                }
            }
            (false, None)
        }
        _ => (false, None),
    }
}

#[cfg(target_os = "linux")]
fn get_agent_systemd_status(label: &str) -> (bool, Option<u32>) {
    let unit = systemd_unit_name(label);
    let output = Command::new("systemctl")
        .args(["--user", "is-active", &unit])
        .output();

    let running = output
        .as_ref()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "active")
        .unwrap_or(false);

    let pid = if running {
        Command::new("systemctl")
            .args(["--user", "show", &unit, "--property=MainPID"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| {
                s.trim()
                    .strip_prefix("MainPID=")
                    .and_then(|p| p.parse::<u32>().ok())
            })
            .filter(|&p| p > 0)
    } else {
        None
    };

    (running, pid)
}

/// Convert an AgentEntry to AgentConfig for API calls.
/// If the P12 password is not in the entry (skip_serializing), retrieve it
/// from the OS credential store.
pub fn agent_entry_to_config(entry: &AgentEntry) -> config::AgentConfig {
    let mut p12_password = entry.p12_password.clone();
    if p12_password.is_none() && entry.auth_method == "p12" {
        if let Ok(Some(pw)) = crate::credentials::get_agent_credential(&entry.label) {
            p12_password = Some(pw);
        }
    }

    config::AgentConfig {
        panel_url: entry.panel_url.clone(),
        auth_method: entry.auth_method.clone(),
        p12_path: entry.p12_path.clone(),
        p12_password,
        keychain_identity: entry.keychain_identity.clone(),
        agent_label: entry.agent_label.clone(),
        domain: entry.domain.clone(),
        chisel_version: entry.chisel_version.clone(),
        setup_at: entry.setup_at.clone(),
        updated_at: entry.updated_at.clone(),
    }
}

/// Read tail of a log file.
fn read_tail(path: &std::path::Path, lines: usize) -> String {
    if !path.exists() {
        return String::new();
    }
    Command::new("tail")
        .args(["-n", &lines.to_string(), &path.to_string_lossy().to_string()])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .unwrap_or_default()
}

/// Read logs for a specific agent.
pub fn read_agent_logs(label: &str, lines: usize) -> String {
    let stdout_log = read_tail(&agent_log_file(label), lines);
    let stderr_log = read_tail(&agent_error_log_file(label), lines);

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
    combined
}

// --- Tauri Commands ---

#[tauri::command]
pub async fn get_agents() -> Result<Vec<AgentWithStatus>, String> {
    tokio::task::spawn_blocking(|| {
        let registry = load_agents_registry()?;
        let agents = match registry {
            Some(r) => r.agents,
            None => vec![],
        };

        let mut result = Vec::with_capacity(agents.len());
        for agent in &agents {
            let (running, pid) = get_agent_chisel_status(&agent.label);
            result.push(AgentWithStatus {
                label: agent.label.clone(),
                panel_url: agent.panel_url.clone(),
                auth_method: agent.auth_method.clone(),
                domain: agent.domain.clone(),
                chisel_version: agent.chisel_version.clone(),
                setup_at: agent.setup_at.clone(),
                updated_at: agent.updated_at.clone(),
                running,
                pid,
            });
        }
        Ok(result)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn get_agent_status(label: String) -> Result<AgentWithStatus, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;
        let registry = load_agents_registry()?
            .ok_or("No agents registry found")?;
        let agent = registry.agents.iter()
            .find(|a| a.label == label)
            .ok_or(format!("Agent \"{}\" not found", label))?;

        let (running, pid) = get_agent_chisel_status(&label);
        Ok(AgentWithStatus {
            label: agent.label.clone(),
            panel_url: agent.panel_url.clone(),
            auth_method: agent.auth_method.clone(),
            domain: agent.domain.clone(),
            chisel_version: agent.chisel_version.clone(),
            setup_at: agent.setup_at.clone(),
            updated_at: agent.updated_at.clone(),
            running,
            pid,
        })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn start_agent(label: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;

        #[cfg(target_os = "macos")]
        {
            let path = plist_path_for(&label);
            if !path.exists() {
                return Err(format!("Plist not found for agent \"{}\". Run portlama-agent setup --label {} first.", label, label));
            }
            let output = Command::new("launchctl")
                .args(["load", &path.to_string_lossy()])
                .output()
                .map_err(|e| format!("Failed to start agent: {}", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Failed to load agent: {}", stderr.trim()));
            }
        }

        #[cfg(target_os = "linux")]
        {
            let unit = systemd_unit_name(&label);
            let output = Command::new("systemctl")
                .args(["--user", "start", &unit])
                .output()
                .map_err(|e| format!("Failed to start agent: {}", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Failed to start agent: {}", stderr.trim()));
            }
        }

        Ok(format!("Agent \"{}\" started", label))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn stop_agent(label: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;

        #[cfg(target_os = "macos")]
        {
            let path = plist_path_for(&label);
            if path.exists() {
                let _ = Command::new("launchctl")
                    .args(["unload", &path.to_string_lossy()])
                    .output();
            }
        }

        #[cfg(target_os = "linux")]
        {
            let unit = systemd_unit_name(&label);
            let _ = Command::new("systemctl")
                .args(["--user", "stop", &unit])
                .output();
        }

        Ok(format!("Agent \"{}\" stopped", label))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn restart_agent(label: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;

        #[cfg(target_os = "macos")]
        {
            let path = plist_path_for(&label);
            if !path.exists() {
                return Err(format!("Plist not found for agent \"{}\".", label));
            }
            let _ = Command::new("launchctl")
                .args(["unload", &path.to_string_lossy()])
                .output();
            Command::new("launchctl")
                .args(["load", &path.to_string_lossy()])
                .output()
                .map_err(|e| format!("Failed to restart agent: {}", e))?;
        }

        #[cfg(target_os = "linux")]
        {
            let unit = systemd_unit_name(&label);
            Command::new("systemctl")
                .args(["--user", "restart", &unit])
                .output()
                .map_err(|e| format!("Failed to restart agent: {}", e))?;
        }

        Ok(format!("Agent \"{}\" restarted", label))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn get_agent_tunnels(label: String) -> Result<Vec<crate::commands::TunnelInfo>, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;
        let registry = load_agents_registry()?
            .ok_or("No agents registry found")?;
        let agent = registry.agents.iter()
            .find(|a| a.label == label)
            .ok_or(format!("Agent \"{}\" not found", label))?;

        let cfg = agent_entry_to_config(agent);
        let body = crate::api::curl_panel(&cfg, "GET", "/api/tunnels", None)?;

        #[derive(serde::Deserialize)]
        struct TunnelsResponse {
            tunnels: Vec<crate::commands::TunnelInfo>,
        }

        let data: TunnelsResponse = serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse tunnels: {}", e))?;
        Ok(data.tunnels)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn get_agent_logs(label: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;
        Ok(read_agent_logs(&label, 100))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn get_agent_config(label: String) -> Result<config::AgentConfig, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;
        let registry = load_agents_registry()?
            .ok_or("No agents registry found")?;
        let agent = registry.agents.iter()
            .find(|a| a.label == label)
            .ok_or(format!("Agent \"{}\" not found", label))?;
        Ok(agent_entry_to_config(agent))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Panel expose status response.
#[derive(Debug, Serialize, Deserialize)]
pub struct PanelExposeStatus {
    pub running: bool,
    pub enabled: bool,
    pub fqdn: Option<String>,
    pub port: Option<u32>,
}

#[tauri::command]
pub async fn get_panel_expose_status(label: String) -> Result<PanelExposeStatus, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;

        // Run: portlama-agent panel --status --label <label> --json
        let output = Command::new("portlama-agent")
            .args(["panel", "--status", "--label", &label, "--json"])
            .output()
            .map_err(|e| format!("Failed to run portlama-agent: {}", e))?;

        if !output.status.success() {
            // Agent may not have the command — return disabled
            return Ok(PanelExposeStatus {
                running: false,
                enabled: false,
                fqdn: None,
                port: None,
            });
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str(stdout.trim())
            .map_err(|e| format!("Failed to parse panel status: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn toggle_panel_expose(label: String, enabled: bool) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;

        let flag = if enabled { "--enable" } else { "--disable" };
        let output = Command::new("portlama-agent")
            .args(["panel", flag, "--label", &label])
            .output()
            .map_err(|e| format!("Failed to run portlama-agent: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to {} panel: {}", if enabled { "enable" } else { "disable" }, stderr.trim()));
        }

        Ok(format!("Panel {} for agent \"{}\"", if enabled { "enabled" } else { "disabled" }, label))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Start the agent panel service locally (no tunnel exposure).
/// Used by the Plugins page to ensure the panel server is running before
/// making API calls.
#[tauri::command]
pub async fn start_agent_panel(label: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;

        let output = Command::new("portlama-agent")
            .args(["panel", "--enable", "--local-only", "--label", &label, "--json"])
            .output()
            .map_err(|e| format!("Failed to run portlama-agent: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to start panel: {}", stderr.trim()));
        }

        serde_json::from_str(stdout.trim())
            .map_err(|e| format!("Failed to parse response: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Stop the agent panel service locally (no tunnel retraction).
#[tauri::command]
pub async fn stop_agent_panel(label: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;

        let output = Command::new("portlama-agent")
            .args(["panel", "--disable", "--local-only", "--label", &label, "--json"])
            .output()
            .map_err(|e| format!("Failed to run portlama-agent: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to stop panel: {}", stderr.trim()));
        }

        serde_json::from_str(stdout.trim())
            .map_err(|e| format!("Failed to parse response: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

// --- Agent Installation ---

/// NDJSON progress event from portlama-agent setup --json.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentInstallProgress {
    event: String,
    step: Option<String>,
    status: Option<String>,
    message: Option<String>,
    agent: Option<AgentInstallInfo>,
    #[allow(dead_code)]
    recoverable: Option<bool>,
}

/// Agent info returned in the NDJSON "complete" event.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentInstallInfo {
    label: String,
    #[allow(dead_code)]
    panel_url: String,
    #[allow(dead_code)]
    auth_method: String,
    #[serde(default)]
    p12_path: Option<String>,
    #[serde(default)]
    p12_password: Option<String>,
    #[allow(dead_code)]
    domain: Option<String>,
    #[allow(dead_code)]
    chisel_version: Option<String>,
}

/// Emit a progress event to the frontend.
fn emit_install_progress(app: &tauri::AppHandle, step: &str, status: &str) {
    let _ = app.emit(
        "agent-install-progress",
        serde_json::json!({ "step": step, "status": status }),
    );
}

/// Locate Node.js and portlama-agent CLI, installing if needed.
/// Emits check_node and install_agent_cli progress events.
fn find_or_install_agent_cli(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Step: check_node
    emit_install_progress(app, "check_node", "running");
    let node_output = Command::new("which")
        .arg("node")
        .output()
        .map_err(|e| format!("Failed to check for Node.js: {}", e))?;

    if !node_output.status.success() {
        emit_install_progress(app, "check_node", "failed");
        return Err(
            "Node.js is not installed. Install Node.js 20+ from https://nodejs.org".to_string(),
        );
    }
    emit_install_progress(app, "check_node", "complete");

    // Step: install_agent_cli
    emit_install_progress(app, "install_agent_cli", "running");

    // Always install/update to the latest version so that bug fixes (e.g.
    // Keychain partition list) are picked up without manual intervention.
    let install_output = Command::new("npm")
        .args(["install", "-g", "@lamalibre/portlama-agent@latest", "--ignore-scripts"])
        .output()
        .map_err(|e| format!("Failed to run npm install: {}", e))?;

    if !install_output.status.success() {
        // If update fails but binary already exists, use the existing version
        if find_portlama_agent().is_none() {
            let stderr = String::from_utf8_lossy(&install_output.stderr);
            emit_install_progress(app, "install_agent_cli", "failed");
            return Err(format!(
                "Failed to install portlama-agent: {}",
                stderr.trim()
            ));
        }
    }

    let cli_path = match find_portlama_agent() {
        Some(p) => p,
        None => {
            // Try npm prefix bin as fallback
            let prefix_output = Command::new("npm")
                .args(["config", "get", "prefix"])
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok());

            if let Some(prefix) = prefix_output {
                let bin_path =
                    PathBuf::from(prefix.trim()).join("bin").join("portlama-agent");
                if bin_path.exists() {
                    bin_path
                } else {
                    emit_install_progress(app, "install_agent_cli", "failed");
                    return Err(
                        "portlama-agent installed but not found in PATH. Check your npm prefix configuration.".to_string()
                    );
                }
            } else {
                emit_install_progress(app, "install_agent_cli", "failed");
                return Err(
                    "portlama-agent installed but not found in PATH".to_string(),
                );
            }
        }
    };

    emit_install_progress(app, "install_agent_cli", "complete");
    Ok(cli_path)
}

/// Find portlama-agent binary in PATH.
fn find_portlama_agent() -> Option<PathBuf> {
    Command::new("which")
        .arg("portlama-agent")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| PathBuf::from(s.trim()))
        .filter(|p| p.exists())
}

/// Install a portlama agent by spawning `portlama-agent setup --json`.
/// Streams NDJSON progress via Tauri events.
#[tauri::command]
pub async fn install_agent(
    app: tauri::AppHandle,
    label: String,
    panel_url: String,
    token: String,
) -> Result<AgentWithStatus, String> {
    validate_agent_label(&label)?;

    // Validate panel URL scheme (prevent file://, gopher://, etc.)
    if !panel_url.starts_with("https://") {
        return Err("Panel URL must use https:// scheme".to_string());
    }

    // Prevent concurrent installations for the same label
    {
        let mut guard = INSTALLING_LABELS.lock().map_err(|_| "Lock poisoned")?;
        if !guard.insert(label.clone()) {
            return Err(format!(
                "Agent \"{}\" is already being installed",
                label
            ));
        }
    }

    let label_guard = label.clone();
    let result: Result<AgentWithStatus, String> = tokio::task::spawn_blocking(move || {
        // Phase 1: Find or install the CLI (emits check_node + install_agent_cli events)
        let cli_path = find_or_install_agent_cli(&app)?;

        // Phase 2: Spawn portlama-agent setup --json
        let mut child = Command::new(&cli_path)
            .args([
                "setup",
                "--json",
                "--label",
                &label,
                "--panel-url",
                &panel_url,
            ])
            .env("PORTLAMA_ENROLLMENT_TOKEN", &token)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Failed to start portlama-agent: {}", e))?;

        let stdout = child.stdout.take().ok_or("No stdout from portlama-agent")?;
        let mut reader = std::io::BufReader::new(stdout);
        let mut last_error: Option<String> = None;
        let mut completed_label: Option<String> = None;
        let mut line_buf = String::new();

        let read_result: Result<(), String> = (|| {
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

                if let Ok(progress) = serde_json::from_str::<AgentInstallProgress>(line) {
                    match progress.event.as_str() {
                        "complete" => {
                            if let Some(ref agent) = progress.agent {
                                completed_label = Some(agent.label.clone());
                                // Store P12 password in OS credential store
                                if let (Some(ref pw), Some(ref _path)) = (&agent.p12_password, &agent.p12_path) {
                                    if let Err(e) = crate::credentials::store_agent_credential(&agent.label, pw) {
                                        eprintln!("Warning: failed to store agent credential: {}", e);
                                    }
                                }
                            }
                        }
                        "error" => {
                            last_error = progress.message.clone();
                            // Only emit failed step if the error event includes a step key
                            if let Some(ref step) = progress.step {
                                emit_install_progress(&app, step, "failed");
                            }
                        }
                        "step" => {
                            if let (Some(ref step), Some(ref status)) =
                                (&progress.step, &progress.status)
                            {
                                emit_install_progress(&app, step, status);
                            }
                        }
                        _ => {}
                    }
                }
            }
            Ok(())
        })();

        // Ensure child process is cleaned up regardless of read outcome
        if read_result.is_err() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(read_result.unwrap_err());
        }

        let exit_status = child
            .wait()
            .map_err(|e| format!("Failed to wait for portlama-agent: {}", e))?;

        if !exit_status.success() {
            if let Some(err) = last_error {
                return Err(format!("Agent setup failed: {}", err));
            }
            return Err("Agent setup failed".to_string());
        }

        // Phase 3: Read the updated registry to return the new agent
        let resolved_label = completed_label.as_deref().unwrap_or(&label);
        let registry = load_agents_registry()?
            .ok_or("Agents registry not found after setup")?;
        let agent = registry
            .agents
            .iter()
            .find(|a| a.label == resolved_label)
            .ok_or(format!(
                "Agent \"{}\" not found in registry after setup",
                resolved_label
            ))?;

        let (running, pid) = get_agent_chisel_status(&agent.label);

        Ok(AgentWithStatus {
            label: agent.label.clone(),
            panel_url: agent.panel_url.clone(),
            auth_method: agent.auth_method.clone(),
            domain: agent.domain.clone(),
            chisel_version: agent.chisel_version.clone(),
            setup_at: agent.setup_at.clone(),
            updated_at: agent.updated_at.clone(),
            running,
            pid,
        })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;

    // Release the concurrency guard regardless of outcome
    if let Ok(mut guard) = INSTALLING_LABELS.lock() {
        guard.remove(&label_guard);
    }

    result
}

// ---------------------------------------------------------------------------
// Agent plugin management
// ---------------------------------------------------------------------------

/// Default port for the agent panel server.
pub(crate) const AGENT_PANEL_PORT: u16 = 9393;

fn validate_plugin_name(name: &str) -> Result<(), String> {
    crate::local_plugins::validate_plugin_name(name)
}

/// Curl the agent's local panel server (plain HTTP on 127.0.0.1:9393).
/// The panel server validates identity via X-SSL-Client-* headers that nginx
/// normally sets. From localhost this is safe — the server binds 127.0.0.1 only.
fn curl_local_panel(
    label: &str,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<String, String> {
    crate::api::curl_agent_local_panel(label, AGENT_PANEL_PORT, method, path, body)
}

#[tauri::command]
pub async fn get_agent_plugins(label: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;
        let body = curl_local_panel(&label, "GET", "/api/plugins", None)?;
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse plugins: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn install_agent_plugin(
    label: String,
    package_name: String,
) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;
        let payload = serde_json::json!({ "packageName": package_name });
        let body = curl_local_panel(
            &label,
            "POST",
            "/api/plugins/install",
            Some(&payload.to_string()),
        )?;
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn enable_agent_plugin(
    label: String,
    name: String,
) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;
        validate_plugin_name(&name)?;
        let path = format!("/api/plugins/{}/enable", name);
        let body = curl_local_panel(&label, "POST", &path, None)?;
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn disable_agent_plugin(
    label: String,
    name: String,
) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;
        validate_plugin_name(&name)?;
        let path = format!("/api/plugins/{}/disable", name);
        let body = curl_local_panel(&label, "POST", &path, None)?;
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn uninstall_agent_plugin(
    label: String,
    name: String,
) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;
        validate_plugin_name(&name)?;
        let path = format!("/api/plugins/{}", name);
        let body = curl_local_panel(&label, "DELETE", &path, None)?;
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn update_agent_plugin(
    label: String,
    name: String,
) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;
        validate_plugin_name(&name)?;
        let path = format!("/api/plugins/{}/update", name);
        let body = curl_local_panel(&label, "POST", &path, None)?;
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn fetch_agent_plugin_bundle(
    label: String,
    name: String,
) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;
        validate_plugin_name(&name)?;
        let api_path = format!("/api/plugins/{}/bundle", name);
        let body = curl_local_panel(&label, "GET", &api_path, None)?;
        let parsed: serde_json::Value =
            serde_json::from_str(&body).map_err(|e| format!("Failed to parse: {}", e))?;
        let source = parsed["source"]
            .as_str()
            .ok_or_else(|| "No source field in bundle response".to_string())?;

        // Split into ~16 KB chunks at character boundaries to avoid WebKit
        // JSON parser issues with large single-string IPC payloads.
        let chunk_size = 16384;
        let mut chunks = Vec::new();
        let mut start = 0;
        while start < source.len() {
            let mut end = std::cmp::min(start + chunk_size, source.len());
            while end < source.len() && !source.is_char_boundary(end) {
                end += 1;
            }
            chunks.push(source[start..end].to_string());
            start = end;
        }
        Ok(chunks)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn check_agent_plugin_update(
    label: String,
    name: String,
) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        validate_agent_label(&label)?;
        validate_plugin_name(&name)?;
        let path = format!("/api/plugins/{}/check-update", name);
        let body = curl_local_panel(&label, "GET", &path, None)?;
        let parsed: serde_json::Value =
            serde_json::from_str(&body).map_err(|e| format!("Failed to parse: {}", e))?;
        Ok(parsed)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

