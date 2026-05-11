use serde::{Deserialize, Serialize};
use std::process::Command;

use crate::config;

/// Default port for the local plugin host daemon.
const PLUGIN_HOST_PORT: u16 = 9293;

// ---------------------------------------------------------------------------
// Data structures (kept for public API compatibility with other modules)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CuratedPlugin {
    pub name: String,
    pub package_name: String,
    pub description: String,
    pub icon: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAppStatus {
    pub installed: bool,
    pub app_path: Option<String>,
    pub product_name: Option<String>,
}

// ---------------------------------------------------------------------------
// Curated plugin list (static data, no daemon call needed)
// ---------------------------------------------------------------------------

fn curated_plugins() -> Vec<CuratedPlugin> {
    vec![
        CuratedPlugin {
            name: "herd".into(),
            package_name: "@lamalibre/herd-server".into(),
            description: "Zero-config LLM inference pooling".into(),
            icon: "cpu".into(),
        },
        CuratedPlugin {
            name: "shell".into(),
            package_name: "@lamalibre/shell-server".into(),
            description: "Secure remote terminal via tmux".into(),
            icon: "terminal".into(),
        },
        CuratedPlugin {
            name: "sync".into(),
            package_name: "@lamalibre/sync-server".into(),
            description: "Bidirectional file sync".into(),
            icon: "folder".into(),
        },
        CuratedPlugin {
            name: "gate".into(),
            package_name: "@lamalibre/gate-server".into(),
            description: "VPN tunnel management".into(),
            icon: "shield".into(),
        },
        CuratedPlugin {
            name: "caravana".into(),
            package_name: "@lamalibre/caravana-server".into(),
            description: "Autonomous feature development — backlog to branch via VM + Claude".into(),
            icon: "rocket".into(),
        },
        CuratedPlugin {
            name: "nerd".into(),
            package_name: "@lamalibre/nerd-server".into(),
            description: "Code analysis and codebase understanding".into(),
            icon: "search".into(),
        },
        CuratedPlugin {
            name: "rodeo".into(),
            package_name: "@lamalibre/rodeo-serverd".into(),
            description: "Shared e2e test execution with tiered VM snapshots".into(),
            icon: "flask-conical".into(),
        },
        CuratedPlugin {
            name: "shepherd".into(),
            package_name: "@lamalibre/shepherd-server".into(),
            description: "Skill registry and scope manager for Claude Code workflows".into(),
            icon: "book-open".into(),
        },
        CuratedPlugin {
            name: "spit".into(),
            package_name: "@lamalibre/spit-server".into(),
            description: "End-to-end encrypted chat with store-and-forward delivery".into(),
            icon: "message-circle".into(),
        },
    ]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Validate a plugin name (same rules as serverd).
pub(crate) fn validate_plugin_name(name: &str) -> Result<(), String> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        return Err(format!("Invalid plugin name: \"{}\". Must contain only lowercase letters, numbers, and hyphens.", name));
    }

    let reserved = [
        "health", "onboarding", "invite", "enroll", "tunnels", "sites", "system",
        "services", "logs", "users", "certs", "invitations", "plugins", "tickets", "settings",
        "identity", "storage", "agents",
    ];
    if reserved.contains(&name) {
        return Err(format!("Plugin name \"{}\" is reserved", name));
    }

    Ok(())
}

/// Make a plain HTTP request to the local plugin host daemon on localhost.
///
/// The host listens on 127.0.0.1:9293 without auth — localhost trust boundary.
/// Plugins are always `@lamalibre/`-scoped and run in the same OS-user context
/// as the desktop app; no cross-user isolation concern.
fn curl_local_host(
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<String, String> {
    let url = format!("http://127.0.0.1:{}{}", PLUGIN_HOST_PORT, path);

    let mut args = vec![
        "-s".to_string(),
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
        return Err(format!("Local plugin host request failed: {}", stderr));
    }

    let body = String::from_utf8_lossy(&output.stdout).to_string();

    if let Ok(err_obj) = serde_json::from_str::<serde_json::Value>(&body) {
        if let Some(error) = err_obj.get("error").and_then(|e| e.as_str()) {
            return Err(error.to_string());
        }
    }

    Ok(body)
}

/// Map plugin name to (bundle identifier, product name) for desktop app detection.
fn desktop_app_info(plugin_name: &str) -> Option<(&'static str, &'static str)> {
    match plugin_name {
        "sync" => Some(("com.lamalibre.sync", "Sync")),
        "herd" => Some(("com.lamalibre.herd", "Herd")),
        "shell" => Some(("com.lamalibre.shell", "Shell")),
        "gate" => Some(("com.lamalibre.gate", "Gate")),
        _ => None,
    }
}

/// Find the .app path for a bundle identifier using macOS `mdfind`.
fn find_app_path(bundle_id: &str, product_name: &str) -> Option<String> {
    // Try mdfind (Spotlight) first
    if let Ok(output) = Command::new("mdfind")
        .args(["kMDItemCFBundleIdentifier", "==", bundle_id])
        .output()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.ends_with(".app") {
                return Some(line.to_string());
            }
        }
    }

    // Fall back to common paths
    let candidates = [
        format!("/Applications/{}.app", product_name),
        format!(
            "{}/Applications/{}.app",
            std::env::var("HOME").unwrap_or_default(),
            product_name
        ),
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return Some(path.clone());
        }
    }
    None
}

/// Recursively copy a directory.
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst)
        .map_err(|e| format!("Failed to create directory {:?}: {}", dst, e))?;

    for entry in std::fs::read_dir(src)
        .map_err(|e| format!("Failed to read directory {:?}: {}", src, e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to get file type: {}", e))?;

        // Skip symlinks to prevent following links outside the plugin directory
        if file_type.is_symlink() {
            continue;
        }

        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if file_type.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("Failed to copy {:?}: {}", src_path, e))?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — delegated to agentd REST API
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn local_get_plugins() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(|| {
        // If the host is not installed or not running, return an empty registry
        // so the page can render instead of surfacing a curl connection error.
        let body = match curl_local_host("GET", "/api/local-plugins", None) {
            Ok(b) => b,
            Err(_) => return Ok(serde_json::json!({ "plugins": [] })),
        };
        serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse response: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn local_get_available_plugins() -> Result<Vec<CuratedPlugin>, String> {
    Ok(curated_plugins())
}

#[tauri::command]
pub async fn local_install_plugin(package_name: String) -> Result<serde_json::Value, String> {
    // Basic scope validation before sending to daemon
    if !package_name.starts_with("@lamalibre/") {
        return Err("Only @lamalibre/ scoped packages are allowed".into());
    }

    let pkg_suffix = &package_name["@lamalibre/".len()..];
    if pkg_suffix.is_empty()
        || !pkg_suffix.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '_' || c == '-')
        || !pkg_suffix.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        || !pkg_suffix.ends_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
    {
        return Err("Invalid package name".into());
    }

    tokio::task::spawn_blocking(move || {
        let payload = serde_json::json!({ "name": package_name });
        let body = curl_local_host("POST", "/api/local-plugins/install", Some(&payload.to_string()))?;
        let parsed: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        // Restart so Fastify mounts the freshly installed plugin's routes.
        crate::daemon_lifecycle::restart_plugin_host()?;

        // Return the plugin entry from the response
        if let Some(plugin) = parsed.get("plugin") {
            Ok(plugin.clone())
        } else {
            Ok(parsed)
        }
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn local_uninstall_plugin(name: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/local-plugins/{}", name);
        curl_local_host("DELETE", &path, None)?;
        // Restart so the uninstalled plugin's routes stop serving.
        crate::daemon_lifecycle::restart_plugin_host()?;
        Ok(format!("Plugin {} uninstalled", name))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn local_enable_plugin(name: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/local-plugins/{}/enable", name);
        curl_local_host("POST", &path, None)?;
        // Restart so Fastify mounts the enabled plugin's routes.
        crate::daemon_lifecycle::restart_plugin_host()?;
        Ok(format!("Plugin {} enabled", name))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn local_disable_plugin(name: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/local-plugins/{}/disable", name);
        curl_local_host("POST", &path, None)?;
        // No restart — the unified plugin host's disabled-catch-all hook
        // returns 503 once the registry is updated and cache is invalidated.
        Ok(format!("Plugin {} disabled", name))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn local_fetch_plugin_bundle(name: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/local-plugins/{}/bundle", name);
        let body = curl_local_host("GET", &path, None)?;
        let parsed: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        // The REST endpoint returns { source: "..." }
        parsed.get("source")
            .and_then(|v| v.as_str())
            .map(String::from)
            .ok_or_else(|| "No source in bundle response".into())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn local_check_plugin_update(name: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/local-plugins/{}/check-update", name);
        let body = curl_local_host("GET", &path, None)?;
        serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse response: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn local_update_plugin(name: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = format!("/api/local-plugins/{}/update", name);
        let body = curl_local_host("POST", &path, None)?;
        let parsed: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        // Restart so Fastify picks up the new plugin version's routes.
        crate::daemon_lifecycle::restart_plugin_host()?;

        // Return the plugin entry from the response
        if let Some(plugin) = parsed.get("plugin") {
            Ok(plugin.clone())
        } else {
            Ok(parsed)
        }
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Read the tail of the local plugin host log file directly from disk.
///
/// The host daemon owns its own lifecycle through the unified `daemon_*`
/// commands in `daemon_lifecycle.rs`; those talk to launchctl/systemctl.
/// Logs are plain text files written by launchd/systemd StdOut/StdErr, so
/// reading them here avoids a round-trip through a daemon that may be down.
#[tauri::command]
pub async fn local_read_host_logs() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let log_path = crate::config::agent_dir().join("local/logs/host.log");
        if !log_path.exists() {
            return Ok(String::new());
        }
        let output = Command::new("tail")
            .args(["-n", "200", log_path.to_str().unwrap_or("")])
            .output()
            .map_err(|e| format!("tail failed: {}", e))?;
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

// ---------------------------------------------------------------------------
// Desktop app commands (macOS-specific, kept in Rust)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn local_check_desktop_app(name: String) -> Result<DesktopAppStatus, String> {
    tokio::task::spawn_blocking(move || {
        let (bundle_id, product_name) = desktop_app_info(&name)
            .ok_or_else(|| format!("No desktop app mapping for plugin \"{}\"", name))?;

        let app_path = find_app_path(bundle_id, product_name);

        Ok(DesktopAppStatus {
            installed: app_path.is_some(),
            app_path,
            product_name: Some(product_name.to_string()),
        })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn local_open_desktop_app(name: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let (bundle_id, product_name) = desktop_app_info(&name)
            .ok_or_else(|| format!("No desktop app mapping for plugin \"{}\"", name))?;

        let app_path = find_app_path(bundle_id, product_name)
            .ok_or_else(|| format!("{}.app not found", product_name))?;

        Command::new("open")
            .arg(&app_path)
            .output()
            .map_err(|e| format!("Failed to open app: {}", e))?;

        Ok(format!("Opened {}", app_path))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn local_uninstall_desktop_app(name: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let (bundle_id, product_name) = desktop_app_info(&name)
            .ok_or_else(|| format!("No desktop app mapping for plugin \"{}\"", name))?;

        let app_path = find_app_path(bundle_id, product_name)
            .ok_or_else(|| format!("{}.app not found", product_name))?;

        // Quit the app if running
        let _ = Command::new("osascript")
            .args([
                "-e",
                &format!("tell application \"{}\" to quit", product_name),
            ])
            .output();

        // Give it a moment to quit gracefully, then force-kill if still running
        std::thread::sleep(std::time::Duration::from_secs(2));
        let _ = Command::new("pkill")
            .args(["-f", &app_path])
            .output();

        // Move to Trash
        Command::new("osascript")
            .args([
                "-e",
                &format!(
                    "tell application \"Finder\" to delete POSIX file \"{}\"",
                    app_path
                ),
            ])
            .output()
            .map_err(|e| format!("Failed to move app to Trash: {}", e))?;

        Ok(format!("Moved {} to Trash", app_path))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn local_install_desktop_app(name: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        // Validate that the plugin name maps to a known desktop app
        let _ = desktop_app_info(&name)
            .ok_or_else(|| format!("No desktop app mapping for plugin \"{}\"", name))?;

        // Convention: @lamalibre/<name>-server -> @lamalibre/install-<name>-desktop
        let installer = format!("@lamalibre/install-{}-desktop", name);

        let output = Command::new("npx")
            .args(["--yes", &installer, "--yes"])
            .output()
            .map_err(|e| format!("Failed to run installer: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Installer failed: {}", stderr));
        }

        Ok(format!("Installed via npx {}", installer))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

// ---------------------------------------------------------------------------
// Migration (kept in Rust — involves curl_panel + credential store)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn migrate_local_plugin_to_agent(name: String, label: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        crate::agents::validate_agent_label(&label)?;

        // 1. Read local plugin registry to find the plugin and validate state
        let body = curl_local_host("GET", "/api/local-plugins", None)?;
        let registry: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse local plugins: {}", e))?;

        let plugins = registry.get("plugins")
            .and_then(|v| v.as_array())
            .ok_or("Failed to read plugins list")?;

        let plugin = plugins.iter()
            .find(|p| p.get("name").and_then(|v| v.as_str()) == Some(&name))
            .ok_or(format!("Plugin \"{}\" not found in local plugins", name))?;

        let status = plugin.get("status").and_then(|v| v.as_str()).unwrap_or("");
        if status == "enabled" {
            return Err("Disable the plugin before migrating".to_string());
        }

        let package_name = plugin.get("packageName")
            .and_then(|v| v.as_str())
            .ok_or("Plugin has no packageName")?
            .to_string();

        // 2. Copy plugin data directory
        let src_plugin_dir = config::local_plugins_dir().join(&name);
        let dst_plugin_dir = crate::agents::agent_data_dir(&label).join("plugins").join(&name);

        if src_plugin_dir.is_dir() {
            copy_dir_recursive(&src_plugin_dir, &dst_plugin_dir)?;
        }

        // 3. Install on agent via local panel API (http://127.0.0.1:9393)
        let payload = serde_json::json!({ "packageName": package_name });

        let install_result = crate::api::curl_agent_local_panel(
            &label,
            crate::agents::AGENT_PANEL_PORT,
            "POST",
            "/api/plugins/install",
            Some(&payload.to_string()),
        );

        if let Err(err) = install_result {
            // Rollback: remove copied plugin dir
            if dst_plugin_dir.is_dir() {
                let _ = std::fs::remove_dir_all(&dst_plugin_dir);
            }
            return Err(format!("Failed to install on agent: {}", err));
        }

        // 4. Uninstall from local plugin host registry
        let delete_path = format!("/api/local-plugins/{}", name);
        if let Err(err) = curl_local_host("DELETE", &delete_path, None) {
            // Non-fatal: plugin is already on agent, local cleanup can be retried
            eprintln!("Warning: failed to remove local plugin entry: {}", err);
        } else {
            // Best-effort restart so the local host stops serving the migrated plugin.
            let _ = crate::daemon_lifecycle::restart_plugin_host();
        }

        // 5. Remove local plugin data directory
        if src_plugin_dir.is_dir() {
            let _ = std::fs::remove_dir_all(&src_plugin_dir);
        }

        Ok(format!(
            "Plugin \"{}\" migrated to agent \"{}\"",
            name, label
        ))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}
