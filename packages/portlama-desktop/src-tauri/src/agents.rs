use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;

use crate::config;

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
pub fn agent_entry_to_config(entry: &AgentEntry) -> config::AgentConfig {
    config::AgentConfig {
        panel_url: entry.panel_url.clone(),
        auth_method: entry.auth_method.clone(),
        p12_path: entry.p12_path.clone(),
        p12_password: entry.p12_password.clone(),
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
