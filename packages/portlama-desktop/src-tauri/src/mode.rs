use crate::config;
use crate::credentials;
use std::io::Write;

/// Set the active mode for a server ("agent" or "admin").
#[tauri::command]
pub async fn set_server_mode(server_id: String, mode: String) -> Result<(), String> {
    if mode != "agent" && mode != "admin" {
        return Err("Mode must be 'agent' or 'admin'".to_string());
    }

    tokio::task::spawn_blocking(move || {
        let registry_path = config::servers_registry_path();
        if !registry_path.exists() {
            return Err("No servers configured".to_string());
        }

        let content = std::fs::read_to_string(&registry_path)
            .map_err(|e| format!("Failed to read servers.json: {}", e))?;
        let mut servers: Vec<serde_json::Value> = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse servers.json: {}", e))?;

        let mut found = false;
        for server in servers.iter_mut() {
            if server.get("id").and_then(|v| v.as_str()) == Some(&server_id) {
                server["activeMode"] = serde_json::Value::String(mode.clone());
                found = true;
                break;
            }
        }

        if !found {
            return Err(format!("Server {} not found", server_id));
        }

        // Atomic write
        let json = serde_json::to_string_pretty(&servers)
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
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Get the active server's mode.
#[tauri::command]
pub async fn get_server_mode() -> Result<String, String> {
    tokio::task::spawn_blocking(|| config::get_active_mode())
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

/// Check if the active server has an admin certificate.
#[tauri::command]
pub async fn has_admin_cert() -> Result<bool, String> {
    tokio::task::spawn_blocking(|| config::has_admin_cert())
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

        // Store password in credential store
        credentials::store_admin_credential(&server_id, &p12_password)?;

        // Update servers.json with admin_auth
        let registry_path = config::servers_registry_path();
        let content = std::fs::read_to_string(&registry_path)
            .map_err(|e| format!("Failed to read servers.json: {}", e))?;
        let mut servers: Vec<serde_json::Value> = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse servers.json: {}", e))?;

        for server in servers.iter_mut() {
            if server.get("id").and_then(|v| v.as_str()) == Some(&server_id) {
                server["adminAuth"] = serde_json::json!({
                    "method": "p12",
                    "p12Path": dest.to_string_lossy()
                });
                break;
            }
        }

        // Atomic write
        let json = serde_json::to_string_pretty(&servers)
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

        // Delete credential
        let _ = credentials::delete_admin_credential(&server_id);

        // Remove admin_auth from servers.json
        let registry_path = config::servers_registry_path();
        let content = std::fs::read_to_string(&registry_path)
            .map_err(|e| format!("Failed to read servers.json: {}", e))?;
        let mut servers: Vec<serde_json::Value> = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse servers.json: {}", e))?;

        for server in servers.iter_mut() {
            if server.get("id").and_then(|v| v.as_str()) == Some(&server_id) {
                if let Some(obj) = server.as_object_mut() {
                    obj.remove("adminAuth");
                    obj.insert("activeMode".to_string(), serde_json::Value::String("agent".to_string()));
                }
                break;
            }
        }

        let json = serde_json::to_string_pretty(&servers)
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
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}
