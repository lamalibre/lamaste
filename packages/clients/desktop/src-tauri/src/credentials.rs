/// OS credential storage for cloud provider API tokens and server P12 passwords.
///
/// macOS: uses `security-framework` crate (direct Keychain API — no CLI, no process listing exposure)
/// Linux: uses `secret-tool` CLI (libsecret / GNOME Keyring) with stdin for secrets
///
/// Tokens and passwords are never stored in plaintext files or passed as CLI arguments.

// Keychain / libsecret service names follow the brand-split rule: ecosystem-level
// surfaces (cloud, storage) live under `com.lamalibre.*`; product-level surfaces
// (lamaste PKI material — server / admin / agent P12 passwords) nest under
// `com.lamalibre.lamaste.*`. The Rust `const &str` items can't `format!()` at
// compile time, so we use literals with a one-line cross-reference comment to
// the `branding` helpers (same pattern Commit 2 used in `main.rs`).

/// Service name for cloud provider API tokens (e.g., DigitalOcean).
// must match branding::ecosystem_bundle_id("cloud")
const CLOUD_SERVICE: &str = "com.lamalibre.cloud";

/// Service name for per-server P12 passwords (keyed by server UUID).
// must match branding::product_bundle_id("server")
const SERVER_SERVICE: &str = "com.lamalibre.lamaste.server";

/// Service name for per-server admin P12 passwords (keyed by server UUID).
// must match branding::product_bundle_id("admin")
const ADMIN_SERVICE: &str = "com.lamalibre.lamaste.admin";

/// Service name for storage provider credentials (e.g., Spaces access key + secret key).
// must match branding::ecosystem_bundle_id("storage")
const STORAGE_SERVICE: &str = "com.lamalibre.storage";

/// Service name for per-agent P12 passwords (keyed by agent label).
// must match branding::product_bundle_id("agent")
const AGENT_SERVICE: &str = "com.lamalibre.lamaste.agent";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Pick the human-readable brand prefix for a Linux secret-tool label based on
/// the service identifier. Product-level services (`com.lamalibre.lamaste.*`)
/// surface as "Lamaste"; ecosystem-level services (anything else under
/// `com.lamalibre.*`) surface as "Lamalibre". This keeps the GNOME Keyring UI
/// consistent with the brand-split rule applied to the service names themselves.
#[cfg(target_os = "linux")]
fn label_brand_for(service: &str) -> &'static str {
    if service.starts_with("com.lamalibre.lamaste.") {
        "Lamaste"
    } else {
        "Lamalibre"
    }
}

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
        let label = format!("{}: {} / {}", label_brand_for(service), service, account);
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
// Cloud provider token API (service: com.lamalibre.cloud)
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
// Server P12 password API (service: com.lamalibre.lamaste.server)
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
// Admin P12 password API (service: com.lamalibre.lamaste.admin)
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

// ---------------------------------------------------------------------------
// Storage credential API (service: com.lamalibre.storage)
// ---------------------------------------------------------------------------

/// Store storage provider credentials in the OS credential store.
/// The secret is typically JSON containing access key + secret key.
pub fn store_storage_credential(account: &str, secret: &str) -> Result<(), String> {
    store_credential_impl(STORAGE_SERVICE, account, secret)
}

/// Retrieve storage provider credentials from the OS credential store.
/// Returns None if no credential is found.
pub fn get_storage_credential(account: &str) -> Result<Option<String>, String> {
    get_credential_impl(STORAGE_SERVICE, account)
}

/// Delete storage provider credentials from the OS credential store.
pub fn delete_storage_credential(account: &str) -> Result<(), String> {
    delete_credential_impl(STORAGE_SERVICE, account)
}

// ---------------------------------------------------------------------------
// Agent P12 password API (service: com.lamalibre.lamaste.agent)
// ---------------------------------------------------------------------------

/// Store an agent's P12 password in the OS credential store (keyed by agent label).
pub fn store_agent_credential(label: &str, password: &str) -> Result<(), String> {
    store_credential_impl(AGENT_SERVICE, label, password)
}

/// Retrieve an agent's P12 password from the OS credential store.
/// Returns None if no credential is found.
pub fn get_agent_credential(label: &str) -> Result<Option<String>, String> {
    get_credential_impl(AGENT_SERVICE, label)
}

/// Delete an agent's P12 password from the OS credential store.
#[allow(dead_code)]
pub fn delete_agent_credential(label: &str) -> Result<(), String> {
    delete_credential_impl(AGENT_SERVICE, label)
}
