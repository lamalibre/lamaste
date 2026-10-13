use crate::cloud;
use crate::config;
use crate::credentials;

// Mode and the admin certificate are properties of a registry entry, so —
// like the rest of the servers registry — they are read and written in the
// file itself, not through the agent daemon.

/// Apply `change` to one registry entry and save the registry.
fn update_server_entry(
    server_id: &str,
    change: impl FnOnce(&mut cloud::ServerEntry),
) -> Result<(), String> {
    let mut servers = cloud::load_servers_registry()?;
    let server = servers
        .iter_mut()
        .find(|s| s.id == server_id)
        .ok_or_else(|| "Server not found".to_string())?;
    change(server);
    cloud::save_servers_registry(&config::servers_registry_path(), &servers)
}

/// Set the active server's mode ("agent" or "admin").
#[tauri::command]
pub async fn set_server_mode(_server_id: String, mode: String) -> Result<(), String> {
    if mode != "agent" && mode != "admin" {
        return Err("Mode must be 'agent' or 'admin'".to_string());
    }

    tokio::task::spawn_blocking(move || {
        let active_id = cloud::load_servers_registry()?
            .into_iter()
            .find(|s| s.active)
            .map(|s| s.id)
            .ok_or_else(|| "No active server".to_string())?;
        update_server_entry(&active_id, |server| server.active_mode = Some(mode))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Get the active server's mode. "agent" when there is no active server.
#[tauri::command]
pub async fn get_server_mode() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let servers = cloud::load_servers_registry()?;
        let is_admin = servers
            .iter()
            .find(|s| s.active)
            .is_some_and(|s| s.active_mode.as_deref() == Some("admin"));
        Ok(if is_admin { "admin" } else { "agent" }.to_string())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Check if the active server has an admin certificate: an imported one, or
/// the primary certificate of a cloud-provisioned server (which is its admin
/// certificate).
#[tauri::command]
pub async fn has_admin_cert() -> Result<bool, String> {
    tokio::task::spawn_blocking(|| {
        let servers = cloud::load_servers_registry()?;
        Ok(servers
            .iter()
            .find(|s| s.active)
            .is_some_and(|s| s.admin_auth.is_some() || s.provider.is_some()))
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

        let p12_path = dest.to_string_lossy().to_string();
        update_server_entry(&server_id, |server| {
            server.admin_auth = Some(config::AdminAuth {
                method: "p12".to_string(),
                p12_path: Some(p12_path),
                keychain_identity: None,
            });
        })?;

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

        update_server_entry(&server_id, |server| {
            server.admin_auth = None;
            server.active_mode = Some("agent".to_string());
        })?;

        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}
