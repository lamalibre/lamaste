/// OS credential storage for cloud provider API tokens and server P12 passwords.
///
/// macOS: uses `security-framework` crate (direct Keychain API — no CLI, no process listing exposure)
/// Linux: uses `secret-tool` CLI (libsecret / GNOME Keyring) with stdin for secrets
///
/// Tokens and passwords are never stored in plaintext files or passed as CLI arguments.

/// Service name for cloud provider API tokens (e.g., DigitalOcean).
const CLOUD_SERVICE: &str = "com.portlama.cloud";

/// Service name for per-server P12 passwords (keyed by server UUID).
const SERVER_SERVICE: &str = "com.portlama.server";

/// Service name for per-server admin P12 passwords (keyed by server UUID).
const ADMIN_SERVICE: &str = "com.portlama.admin";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

#[allow(unused_variables)]
fn store_credential_impl(service: &str, account: &str, secret: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        security_framework::passwords::set_generic_password(service, account, secret.as_bytes())
            .map_err(|e| format!("Failed to store credential: {}", e))
    }

    #[cfg(target_os = "linux")]
    {
        use std::io::Write;
        let label = format!("Portlama: {} / {}", service, account);
        let mut child = std::process::Command::new("secret-tool")
            .args([
                "store",
                "--label",
                &label,
                "service",
                service,
                "account",
                account,
            ])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to run secret-tool: {}", e))?;

        if let Some(ref mut stdin) = child.stdin {
            stdin
                .write_all(secret.as_bytes())
                .map_err(|e| format!("Failed to write to secret-tool: {}", e))?;
        }

        let output = child
            .wait_with_output()
            .map_err(|e| format!("Failed to wait for secret-tool: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to store credential: {}", stderr));
        }
        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        Err("Credential storage is not supported on this platform".to_string())
    }
}

#[allow(unused_variables)]
fn get_credential_impl(service: &str, account: &str) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        match security_framework::passwords::get_generic_password(service, account) {
            Ok(bytes) => {
                let token = String::from_utf8_lossy(&bytes).to_string();
                if token.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(token))
                }
            }
            Err(e) if e.code() == -25300 => Ok(None), // errSecItemNotFound
            Err(e) => Err(format!("Failed to retrieve credential: {}", e)),
        }
    }

    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new("secret-tool")
            .args(["lookup", "service", service, "account", account])
            .output()
            .map_err(|e| format!("Failed to run secret-tool: {}", e))?;

        if !output.status.success() {
            return Ok(None);
        }
        let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if token.is_empty() {
            return Ok(None);
        }
        Ok(Some(token))
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        Err("Credential storage is not supported on this platform".to_string())
    }
}

#[allow(unused_variables)]
fn delete_credential_impl(service: &str, account: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        match security_framework::passwords::delete_generic_password(service, account) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == -25300 => Ok(()), // errSecItemNotFound
            Err(e) => Err(format!("Failed to delete credential: {}", e)),
        }
    }

    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new("secret-tool")
            .args(["clear", "service", service, "account", account])
            .output()
            .map_err(|e| format!("Failed to run secret-tool: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to delete credential: {}", stderr));
        }
        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        Err("Credential storage is not supported on this platform".to_string())
    }
}

// ---------------------------------------------------------------------------
// Cloud provider token API (service: com.portlama.cloud)
// ---------------------------------------------------------------------------

/// Store a cloud provider API token in the OS credential store.
pub fn store_credential(provider: &str, token: &str) -> Result<(), String> {
    store_credential_impl(CLOUD_SERVICE, provider, token)
}

/// Retrieve a cloud provider API token from the OS credential store.
/// Returns None if no credential is found.
pub fn get_credential(provider: &str) -> Result<Option<String>, String> {
    get_credential_impl(CLOUD_SERVICE, provider)
}

/// Delete a cloud provider API token from the OS credential store.
pub fn delete_credential(provider: &str) -> Result<(), String> {
    delete_credential_impl(CLOUD_SERVICE, provider)
}

// ---------------------------------------------------------------------------
// Server P12 password API (service: com.portlama.server)
// ---------------------------------------------------------------------------

/// Store a server's P12 password in the OS credential store (keyed by server UUID).
pub fn store_server_credential(server_id: &str, password: &str) -> Result<(), String> {
    store_credential_impl(SERVER_SERVICE, server_id, password)
}

/// Retrieve a server's P12 password from the OS credential store.
/// Returns None if no credential is found.
pub fn get_server_credential(server_id: &str) -> Result<Option<String>, String> {
    get_credential_impl(SERVER_SERVICE, server_id)
}

/// Delete a server's P12 password from the OS credential store.
pub fn delete_server_credential(server_id: &str) -> Result<(), String> {
    delete_credential_impl(SERVER_SERVICE, server_id)
}

// ---------------------------------------------------------------------------
// Admin P12 password API (service: com.portlama.admin)
// ---------------------------------------------------------------------------

/// Store an admin P12 password in the OS credential store (keyed by server UUID).
pub fn store_admin_credential(server_id: &str, password: &str) -> Result<(), String> {
    store_credential_impl(ADMIN_SERVICE, server_id, password)
}

/// Retrieve an admin P12 password from the OS credential store.
/// Returns None if no credential is found.
pub fn get_admin_credential(server_id: &str) -> Result<Option<String>, String> {
    get_credential_impl(ADMIN_SERVICE, server_id)
}

/// Delete an admin P12 password from the OS credential store.
pub fn delete_admin_credential(server_id: &str) -> Result<(), String> {
    delete_credential_impl(ADMIN_SERVICE, server_id)
}
