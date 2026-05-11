/// Cloud provisioning Tauri commands.
///
/// These commands bridge the React UI to the `@lamalibre/lamaste-cloud`
/// Node.js package. Cloud API tokens are stored in the OS credential store
/// and passed to Node.js via environment variables (never CLI args).
use crate::config;
use crate::credentials;
use crate::mode::curl_agentd;

use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use tauri::Emitter;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TokenValidation {
    pub valid: bool,
    pub email: String,
    pub missing_scopes: Vec<String>,
    pub excess_scopes: Vec<String>,
    pub has_dns_access: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DODomain {
    pub name: String,
    pub ttl: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DODomainRecord {
    pub id: u64,
    #[serde(rename = "type")]
    pub record_type: String,
    pub name: String,
    pub data: String,
    pub ttl: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RegionWithLatency {
    pub slug: String,
    pub name: String,
    pub available: bool,
    pub latency_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DropletSize {
    pub slug: String,
    pub memory: u64,
    pub vcpus: u64,
    pub disk: u64,
    pub price_monthly: f64,
    pub available: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ServerEntry {
    pub id: String,
    pub label: String,
    pub panel_url: String,
    pub ip: String,
    pub domain: Option<String>,
    pub provider: Option<String>,
    pub provider_id: Option<String>,
    pub region: Option<String>,
    pub created_at: String,
    pub active: bool,
    pub auth_method: String,
    pub keychain_identity: Option<String>,
    pub p12_path: Option<String>,
    pub p12_password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub admin_auth: Option<config::AdminAuth>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerHealth {
    pub online: bool,
    pub status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ProvisionProgress {
    event: String,
    step: Option<String>,
    status: Option<String>,
    message: Option<String>,
    data: Option<serde_json::Value>,
    server: Option<ServerEntry>,
    recoverable: Option<bool>,
}

// ---------------------------------------------------------------------------
// Storage types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StorageServerEntry {
    pub id: String,
    pub label: String,
    pub provider: String,
    pub region: String,
    pub bucket: String,
    pub endpoint: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SpacesRegion {
    pub slug: String,
    pub name: String,
    pub endpoint: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageProvisionProgress {
    event: String,
    step: Option<String>,
    status: Option<String>,
    message: Option<String>,
    data: Option<serde_json::Value>,
    storage_server: Option<StorageServerEntry>,
    recoverable: Option<bool>,
}

/// JSON structure for storage credentials in the OS credential store.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageCredentials {
    access_key: String,
    secret_key: String,
}

// ---------------------------------------------------------------------------
// Agentd REST helpers
// ---------------------------------------------------------------------------

// curl_agentd is imported from crate::mode — single definition for all
// modules that call the local agentd REST API on 127.0.0.1:9393.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Check if an IPv6 address is in a private/reserved range.
fn is_private_ipv6(v6: &std::net::Ipv6Addr) -> bool {
    if v6.is_loopback() {
        return true;
    }
    let segs = v6.segments();
    // Unique Local Address (fc00::/7)
    if segs[0] & 0xfe00 == 0xfc00 {
        return true;
    }
    // Link-local (fe80::/10)
    if segs[0] & 0xffc0 == 0xfe80 {
        return true;
    }
    // IPv4-mapped (::ffff:x.x.x.x) — check the embedded IPv4 address
    if let Some(v4) = v6.to_ipv4_mapped() {
        return v4.is_loopback()
            || v4.is_private()
            || v4.is_link_local()
            || v4.octets()[0] == 100 && (v4.octets()[1] & 0xC0) == 64;
    }
    false
}

/// Validate that a panel URL is safe to use (HTTPS only, no private IPs).
fn validate_panel_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim_end_matches('/');
    if !trimmed.starts_with("https://") {
        return Err("Panel URL must use HTTPS scheme".to_string());
    }
    // Extract hostname (strip scheme and port, handle IPv6 brackets)
    let after_scheme = trimmed.strip_prefix("https://").unwrap_or("");
    let host = if after_scheme.starts_with('[') {
        // IPv6 literal: [::1]:9292
        after_scheme
            .strip_prefix('[')
            .and_then(|s| s.split(']').next())
            .unwrap_or("")
    } else {
        after_scheme.split(':').next().unwrap_or("")
    };
    if host.is_empty() {
        return Err("Panel URL has no hostname".to_string());
    }
    // Block obvious private/reserved ranges
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        let is_private = match ip {
            std::net::IpAddr::V4(v4) => {
                v4.is_loopback()
                    || v4.is_private()
                    || v4.is_link_local()
                    || v4.is_unspecified()
                    || v4.is_broadcast()
                    || v4.octets()[0] == 100 && (v4.octets()[1] & 0xC0) == 64 // CGNAT
            }
            std::net::IpAddr::V6(ref v6) => is_private_ipv6(v6),
        };
        if is_private {
            return Err("Panel URL must not point to a private or reserved IP address".to_string());
        }
    }
    Ok(())
}

/// Allowed providers for cloud token credential storage.
const ALLOWED_PROVIDERS: &[&str] = &["digitalocean"];

/// Validate a server label: lowercase alphanumeric + hyphens, 1-64 chars,
/// must start and end with a letter or number.
pub fn validate_label(label: &str) -> Result<(), String> {
    if label.is_empty() || label.len() > 64 {
        return Err("Label must be 1-64 characters".to_string());
    }
    let bytes = label.as_bytes();
    let is_alnum = |b: u8| b.is_ascii_lowercase() || b.is_ascii_digit();
    if !is_alnum(bytes[0]) || (bytes.len() > 1 && !is_alnum(bytes[bytes.len() - 1])) {
        return Err(
            "Label must start and end with a lowercase letter or number".to_string(),
        );
    }
    if !label.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        return Err(
            "Label must contain only lowercase letters, numbers, and hyphens".to_string(),
        );
    }
    Ok(())
}

/// Validate a Spaces region slug against the known region list.
fn validate_spaces_region(region: &str) -> Result<(), String> {
    const VALID_REGIONS: &[&str] = &["nyc3", "sfo3", "ams3", "sgp1", "fra1", "syd1", "blr1"];
    if !VALID_REGIONS.contains(&region) {
        return Err(format!("Invalid Spaces region: {}", region));
    }
    Ok(())
}

/// Validate a bucket name: 3-63 chars, lowercase alphanumeric + hyphens,
/// must start and end with alphanumeric.
fn validate_bucket_name(bucket: &str) -> Result<(), String> {
    let len = bucket.len();
    if len < 3 || len > 63 {
        return Err("Bucket name must be 3-63 characters".to_string());
    }
    let bytes = bucket.as_bytes();
    let is_alnum = |b: u8| b.is_ascii_lowercase() || b.is_ascii_digit();
    if !is_alnum(bytes[0]) || !is_alnum(bytes[len - 1]) {
        return Err("Bucket name must start and end with a lowercase letter or number".to_string());
    }
    if !bucket.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        return Err("Bucket name must contain only lowercase letters, numbers, and hyphens".to_string());
    }
    Ok(())
}

/// Validate a provider name against the allow-list.
fn validate_provider(provider: &str) -> Result<(), String> {
    if !ALLOWED_PROVIDERS.contains(&provider) {
        return Err(format!("Unsupported provider: {}", provider));
    }
    Ok(())
}

/// Validate a fully-qualified domain name (mirrors FQDN_REGEX in provisioner.ts).
fn validate_domain(domain: &str) -> Result<(), String> {
    fn is_valid_label(label: &str) -> bool {
        let len = label.len();
        len >= 1
            && len <= 63
            && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            && label.as_bytes()[0].is_ascii_alphanumeric()
            && label.as_bytes()[len - 1].is_ascii_alphanumeric()
    }
    let parts: Vec<&str> = domain.split('.').collect();
    if parts.len() < 2 {
        return Err(format!("Invalid domain name: {}", domain));
    }
    let tld = parts.last().unwrap();
    if tld.len() < 2 || !tld.bytes().all(|b| b.is_ascii_alphabetic()) {
        return Err(format!("Invalid domain name: {}", domain));
    }
    for part in &parts[..parts.len() - 1] {
        if !is_valid_label(part) {
            return Err(format!("Invalid domain name: {}", domain));
        }
    }
    Ok(())
}

/// Validate a subdomain label (mirrors SUBDOMAIN_REGEX in provisioner.ts).
fn validate_subdomain(subdomain: &str) -> Result<(), String> {
    let len = subdomain.len();
    if len == 0 || len > 63 {
        return Err(format!("Invalid subdomain: {}", subdomain));
    }
    if !subdomain
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err(format!("Invalid subdomain: {}", subdomain));
    }
    let bytes = subdomain.as_bytes();
    if !(bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        || !(bytes[len - 1].is_ascii_lowercase() || bytes[len - 1].is_ascii_digit())
    {
        return Err(format!("Invalid subdomain: {}", subdomain));
    }
    Ok(())
}

/// Atomically save the servers registry with fsync before rename.
/// File permissions are set to 0600 (contains credentials).
pub fn save_servers_registry(
    path: &std::path::Path,
    servers: &[ServerEntry],
) -> Result<(), String> {
    let json = serde_json::to_string_pretty(servers)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    let tmp_path = path.with_extension("json.tmp");

    {
        let mut file = File::create(&tmp_path)
            .map_err(|e| format!("Failed to create temp file: {}", e))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("Failed to write temp file: {}", e))?;
        file.sync_all()
            .map_err(|e| format!("Failed to fsync temp file: {}", e))?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Failed to set permissions: {}", e))?;
    }

    std::fs::rename(&tmp_path, path)
        .map_err(|e| format!("Failed to save registry: {}", e))?;

    Ok(())
}

/// Migrate P12 passwords from the registry JSON to the OS credential store.
/// For each entry that still has a `p12_password` in the JSON, move it to
/// the credential store (keyed by server ID) and clear the field.
/// Rewrites `servers.json` only if changes were made.
fn migrate_p12_passwords(
    servers: &mut Vec<ServerEntry>,
    registry_path: &std::path::Path,
) -> Result<(), String> {
    let mut changed = false;
    for server in servers.iter_mut() {
        if let Some(ref password) = server.p12_password {
            if !password.is_empty() {
                credentials::store_server_credential(&server.id, password)?;
                server.p12_password = None;
                changed = true;
            }
        }
    }
    if changed {
        save_servers_registry(registry_path, servers)?;
    }
    Ok(())
}

/// Resolve the path to the lamaste-cloud CLI entry point.
/// Uses the workspace path (CARGO_MANIFEST_DIR is baked at compile time),
/// then falls back to PATH lookup.
fn cloud_cli_path() -> PathBuf {
    // CARGO_MANIFEST_DIR is set at compile time — works in both debug and release
    let workspace_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../lamaste-cloud/bin/lamaste-cloud.js");
    if let Ok(canonical) = workspace_path.canonicalize() {
        if canonical.exists() {
            return canonical;
        }
    }

    // Fallback: assume lamaste-cloud is in PATH
    PathBuf::from("lamaste-cloud")
}

/// Run a lamaste-cloud CLI command and return the stdout output.
fn run_cloud_cmd(
    args: &[&str],
    token: &str,
) -> Result<String, String> {
    let cli_path = cloud_cli_path();

    let output = std::process::Command::new("node")
        .arg(&cli_path)
        .args(args)
        .env("LAMALIBRE_CLOUD_TOKEN", token)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn lamaste-cloud: {}", e))?
        .wait_with_output()
        .map_err(|e| format!("Failed to run lamaste-cloud: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "lamaste-cloud {} failed: {}{}",
            args.first().unwrap_or(&""),
            stderr,
            if !stdout.is_empty() {
                format!("\n{}", stdout)
            } else {
                String::new()
            }
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Run a lamaste-cloud CLI command for storage operations.
/// Passes Spaces credentials via environment variables.
fn run_storage_cmd(
    args: &[&str],
    access_key: &str,
    secret_key: &str,
) -> Result<String, String> {
    let cli_path = cloud_cli_path();

    let output = std::process::Command::new("node")
        .arg(&cli_path)
        .args(args)
        .env("LAMALIBRE_SPACES_ACCESS_KEY", access_key)
        .env("LAMALIBRE_SPACES_SECRET_KEY", secret_key)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn lamaste-cloud: {}", e))?
        .wait_with_output()
        .map_err(|e| format!("Failed to run lamaste-cloud: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "lamaste-cloud {} failed: {}{}",
            args.first().unwrap_or(&""),
            stderr,
            if !stdout.is_empty() {
                format!("\n{}", stdout)
            } else {
                String::new()
            }
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Run a lamaste-cloud CLI command that requires no credentials.
fn run_cloud_cmd_no_credentials(args: &[&str]) -> Result<String, String> {
    let cli_path = cloud_cli_path();

    let output = std::process::Command::new("node")
        .arg(&cli_path)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn lamaste-cloud: {}", e))?
        .wait_with_output()
        .map_err(|e| format!("Failed to run lamaste-cloud: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "lamaste-cloud {} failed: {}",
            args.first().unwrap_or(&""),
            stderr,
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Load storage credentials from the OS credential store.
/// Returns the parsed access key and secret key.
fn load_storage_credentials() -> Result<StorageCredentials, String> {
    let json = credentials::get_storage_credential("spaces")?
        .ok_or("No storage credentials stored. Please add your Spaces access keys first.")?;
    serde_json::from_str::<StorageCredentials>(&json)
        .map_err(|e| format!("Failed to parse stored storage credentials: {}", e))
}

// ---------------------------------------------------------------------------
// Credential commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn store_cloud_token(provider: String, token: String) -> Result<(), String> {
    validate_provider(&provider)?;
    tokio::task::spawn_blocking(move || credentials::store_credential(&provider, &token))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn get_cloud_token(provider: String) -> Result<Option<String>, String> {
    validate_provider(&provider)?;
    tokio::task::spawn_blocking(move || credentials::get_credential(&provider))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn delete_cloud_token(provider: String) -> Result<(), String> {
    validate_provider(&provider)?;
    tokio::task::spawn_blocking(move || credentials::delete_credential(&provider))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

// ---------------------------------------------------------------------------
// Token validation
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn validate_cloud_token(
    provider: String,
    token: String,
) -> Result<TokenValidation, String> {
    validate_provider(&provider)?;
    let provider_clone = provider.clone();
    // If no token was provided, retrieve from credential store
    let effective_token = if token.is_empty() {
        tokio::task::spawn_blocking(move || credentials::get_credential(&provider_clone))
            .await
            .map_err(|e| format!("Task failed: {}", e))??
            .ok_or("No cloud token stored. Please add your API token first.")?
    } else {
        token
    };

    tokio::task::spawn_blocking(move || {
        let output = run_cloud_cmd(&["validate"], &effective_token)?;
        serde_json::from_str::<TokenValidation>(output.trim())
            .map_err(|e| format!("Failed to parse validation result: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

// ---------------------------------------------------------------------------
// Server discovery
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredServer {
    pub droplet_id: String,
    pub name: String,
    pub status: String,
    pub ip: Option<String>,
    pub region: String,
    pub created_at: String,
    pub domains: Vec<String>,
    pub panel_url: Option<String>,
    pub healthy: bool,
}

#[tauri::command]
pub async fn discover_servers(token: String) -> Result<Vec<DiscoveredServer>, String> {
    let effective_token = if token.is_empty() {
        let provider = "digitalocean".to_string();
        tokio::task::spawn_blocking(move || credentials::get_credential(&provider))
            .await
            .map_err(|e| format!("Task failed: {}", e))??
            .ok_or("No cloud token stored. Please provide your API token.")?
    } else {
        token
    };

    tokio::task::spawn_blocking(move || {
        let output = run_cloud_cmd(&["discover"], &effective_token)?;

        // Parse the discover output (array of servers without health status)
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct RawDiscovered {
            droplet_id: String,
            name: String,
            status: String,
            ip: Option<String>,
            region: String,
            created_at: String,
            domains: Vec<String>,
            panel_url: Option<String>,
        }

        let raw: Vec<RawDiscovered> = serde_json::from_str(output.trim())
            .map_err(|e| format!("Failed to parse discover result: {}", e))?;

        // Health-check each panel URL
        let results: Vec<DiscoveredServer> = raw.into_iter().map(|r| {
            let healthy = r.panel_url.as_ref().is_some_and(|url| {
                let health_url = format!("{}/api/health", url.trim_end_matches('/'));
                std::process::Command::new("curl")
                    .args(["-s", "-f", "--max-time", "10", "-k", "--proto", "=https", &health_url])
                    .output()
                    .is_ok_and(|o| o.status.success())
            });

            DiscoveredServer {
                droplet_id: r.droplet_id,
                name: r.name,
                status: r.status,
                ip: r.ip,
                region: r.region,
                created_at: r.created_at,
                domains: r.domains,
                panel_url: r.panel_url,
                healthy,
            }
        }).collect();

        Ok(results)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn register_discovered_server(
    droplet_id: String,
    ip: String,
    region: String,
    created_at: String,
    domain: Option<String>,
    panel_url: String,
    label: String,
) -> Result<ServerEntry, String> {
    validate_label(&label)?;
    validate_panel_url(&panel_url)?;

    let panel_url_clone = panel_url.clone();
    tokio::task::spawn_blocking(move || {
        // Prevent duplicate registration
        let path = config::servers_registry_path();
        let dir = path.parent().unwrap();
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| format!("Failed to set directory permissions: {}", e))?;
        }

        let mut servers: Vec<ServerEntry> = if path.exists() {
            let content = std::fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read: {}", e))?;
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            vec![]
        };

        if servers.iter().any(|s| s.provider_id.as_deref() == Some(&droplet_id)) {
            return Err(format!("Server with droplet ID {} is already registered", droplet_id));
        }

        let entry = ServerEntry {
            id: uuid::Uuid::new_v4().to_string(),
            label,
            panel_url: panel_url_clone.trim_end_matches('/').to_string(),
            ip,
            domain,
            provider: Some("digitalocean".to_string()),
            provider_id: Some(droplet_id),
            region: Some(region),
            created_at,
            active: servers.is_empty(),
            auth_method: "p12".to_string(),
            keychain_identity: None,
            p12_path: None,
            p12_password: None,
            admin_auth: None,
        };

        servers.push(entry.clone());
        save_servers_registry(&path, &servers)?;

        Ok(entry)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

// ---------------------------------------------------------------------------
// Region listing
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_cloud_regions(
    provider: String,
) -> Result<Vec<RegionWithLatency>, String> {
    validate_provider(&provider)?;
    // Retrieve token from credential store
    let token = tokio::task::spawn_blocking(move || credentials::get_credential(&provider))
        .await
        .map_err(|e| format!("Task failed: {}", e))??
        .ok_or("No cloud token stored. Please add your API token first.")?;

    tokio::task::spawn_blocking(move || {
        let output = run_cloud_cmd(&["regions"], &token)?;
        serde_json::from_str::<Vec<RegionWithLatency>>(output.trim())
            .map_err(|e| format!("Failed to parse regions: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

// ---------------------------------------------------------------------------
// Size listing
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_cloud_sizes(
    provider: String,
    region: String,
) -> Result<Vec<DropletSize>, String> {
    validate_provider(&provider)?;
    let token = tokio::task::spawn_blocking(move || credentials::get_credential(&provider))
        .await
        .map_err(|e| format!("Task failed: {}", e))??
        .ok_or("No cloud token stored. Please add your API token first.")?;

    tokio::task::spawn_blocking(move || {
        let output = run_cloud_cmd(&["sizes", "--region", &region], &token)?;
        serde_json::from_str::<Vec<DropletSize>>(output.trim())
            .map_err(|e| format!("Failed to parse sizes: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

// ---------------------------------------------------------------------------
// DNS domain management
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_cloud_domains(provider: String) -> Result<Vec<DODomain>, String> {
    validate_provider(&provider)?;
    let token = tokio::task::spawn_blocking(move || credentials::get_credential(&provider))
        .await
        .map_err(|e| format!("Task failed: {}", e))??
        .ok_or("No cloud token stored. Please add your API token first.")?;

    tokio::task::spawn_blocking(move || {
        let output = run_cloud_cmd(&["domains"], &token)?;
        serde_json::from_str::<Vec<DODomain>>(output.trim())
            .map_err(|e| format!("Failed to parse domains: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn create_cloud_domain(
    provider: String,
    name: String,
) -> Result<DODomain, String> {
    validate_provider(&provider)?;
    validate_domain(&name)?;
    let token = tokio::task::spawn_blocking(move || credentials::get_credential(&provider))
        .await
        .map_err(|e| format!("Task failed: {}", e))??
        .ok_or("No cloud token stored. Please add your API token first.")?;

    tokio::task::spawn_blocking(move || {
        let output = run_cloud_cmd(&["create-domain", "--name", &name], &token)?;
        serde_json::from_str::<DODomain>(output.trim())
            .map_err(|e| format!("Failed to parse domain: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn get_cloud_domain_records(
    provider: String,
    domain: String,
) -> Result<Vec<DODomainRecord>, String> {
    validate_provider(&provider)?;
    validate_domain(&domain)?;
    let token = tokio::task::spawn_blocking(move || credentials::get_credential(&provider))
        .await
        .map_err(|e| format!("Task failed: {}", e))??
        .ok_or("No cloud token stored. Please add your API token first.")?;

    tokio::task::spawn_blocking(move || {
        let output = run_cloud_cmd(&["domain-records", "--domain", &domain], &token)?;
        serde_json::from_str::<Vec<DODomainRecord>>(output.trim())
            .map_err(|e| format!("Failed to parse domain records: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn provision_server(
    app_handle: tauri::AppHandle,
    provider: String,
    region: String,
    label: String,
    size: Option<String>,
    domain: Option<String>,
    email: Option<String>,
    do_domain: Option<String>,
    do_subdomain: Option<String>,
    override_dns: Option<bool>,
) -> Result<ServerEntry, String> {
    validate_provider(&provider)?;
    validate_label(&label)?;
    if let Some(ref d) = do_domain {
        validate_domain(d)?;
    }
    if let Some(ref s) = do_subdomain {
        validate_subdomain(s)?;
    }
    if let Some(ref d) = domain {
        validate_domain(d)?;
    }
    let provider_clone = provider.clone();
    let token = tokio::task::spawn_blocking(move || credentials::get_credential(&provider_clone))
        .await
        .map_err(|e| format!("Task failed: {}", e))??
        .ok_or("No cloud token stored. Please add your API token first.")?;

    tokio::task::spawn_blocking(move || {
        let cli_path = cloud_cli_path();

        let mut args = vec![
            "provision".to_string(),
            "--provider".to_string(),
            provider,
            "--region".to_string(),
            region,
            "--label".to_string(),
            label,
        ];
        if let Some(s) = size {
            args.push("--size".to_string());
            args.push(s);
        }
        if let Some(d) = domain {
            args.push("--domain".to_string());
            args.push(d);
        }
        if let Some(e) = email {
            args.push("--email".to_string());
            args.push(e);
        }
        if let Some(dd) = do_domain {
            args.push("--do-domain".to_string());
            args.push(dd);
        }
        if let Some(ds) = do_subdomain {
            args.push("--do-subdomain".to_string());
            args.push(ds);
        }
        if override_dns.unwrap_or(false) {
            args.push("--override-dns".to_string());
        }

        let mut child = std::process::Command::new("node")
            .arg(&cli_path)
            .args(&args)
            .env("LAMALIBRE_CLOUD_TOKEN", &token)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn provisioner: {}", e))?;

        // Read NDJSON progress from stdout
        let stdout = child.stdout.take().ok_or("No stdout")?;
        let reader = std::io::BufReader::new(stdout);
        let mut last_server: Option<ServerEntry> = None;
        let mut last_error: Option<String> = None;

        for line in reader.lines() {
            let line = line.map_err(|e| format!("Read error: {}", e))?;
            if line.trim().is_empty() {
                continue;
            }

            if let Ok(progress) = serde_json::from_str::<ProvisionProgress>(&line) {
                match progress.event.as_str() {
                    "complete" => {
                        last_server = progress.server;
                    }
                    "error" => {
                        last_error = progress.message.clone();
                        // Emit error step to frontend
                        if let Some(ref step) = progress.step {
                            let _ = app_handle.emit("provision-progress", serde_json::json!({
                                "step": step,
                                "status": "failed",
                            }));
                        }
                    }
                    "step" => {
                        if let (Some(ref step), Some(ref status)) = (&progress.step, &progress.status) {
                            let _ = app_handle.emit("provision-progress", serde_json::json!({
                                "step": step,
                                "status": status,
                            }));
                        }
                    }
                    _ => {}
                }
            }
        }

        let status = child
            .wait()
            .map_err(|e| format!("Failed to wait for provisioner: {}", e))?;

        if !status.success() {
            if let Some(err) = last_error {
                return Err(format!("Provisioning failed: {}", err));
            }
            return Err("Provisioning failed".to_string());
        }

        let mut server = last_server
            .ok_or("Provisioning completed but no server entry returned".to_string())?;
        // Redact sensitive fields before returning to the frontend
        server.p12_password = None;
        Ok(server)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

// ---------------------------------------------------------------------------
// Server management
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn destroy_cloud_server(server_id: String) -> Result<(), String> {
    let server_id_for_read = server_id.clone();

    // Load registry in a blocking task to get provider details
    let (provider_name, provider_id) = tokio::task::spawn_blocking(move || {
        let registry_path = config::servers_registry_path();
        let content = std::fs::read_to_string(&registry_path)
            .map_err(|e| format!("Failed to read servers.json: {}", e))?;
        let servers: Vec<ServerEntry> = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse servers.json: {}", e))?;
        let server = servers
            .iter()
            .find(|s| s.id == server_id_for_read)
            .ok_or("Server not found")?;
        let pname = server
            .provider
            .as_ref()
            .ok_or("Server has no cloud provider — cannot destroy")?
            .clone();
        let pid = server
            .provider_id
            .as_ref()
            .ok_or("Server has no provider ID — cannot destroy")?
            .clone();
        Ok::<(String, String), String>((pname, pid))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    validate_provider(&provider_name)?;
    let token = tokio::task::spawn_blocking(move || credentials::get_credential(&provider_name))
        .await
        .map_err(|e| format!("Task failed: {}", e))??
        .ok_or("No cloud token stored for this provider")?;

    let provider_id_clone = provider_id.clone();
    tokio::task::spawn_blocking(move || {
        run_cloud_cmd(&["destroy", "--id", &provider_id_clone], &token)?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    // Re-read registry after destroy to avoid TOCTOU, then remove the entry
    let server_id_for_write = server_id.clone();
    tokio::task::spawn_blocking(move || {
        let registry_path = config::servers_registry_path();
        let content = std::fs::read_to_string(&registry_path)
            .map_err(|e| format!("Failed to read servers.json: {}", e))?;
        let servers: Vec<ServerEntry> = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse servers.json: {}", e))?;
        let filtered: Vec<ServerEntry> =
            servers.into_iter().filter(|s| s.id != server_id_for_write).collect();
        save_servers_registry(&registry_path, &filtered)?;
        // Clean up P12 password from credential store
        let _ = credentials::delete_server_credential(&server_id_for_write);
        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

// ---------------------------------------------------------------------------
// Server registry commands
// ---------------------------------------------------------------------------

/// Strip sensitive fields (p12_password) from server entries before returning to the frontend.
/// Load servers from registry (blocking). Returns unredacted entries.
pub fn load_servers_registry() -> Result<Vec<ServerEntry>, String> {
    let path = config::servers_registry_path();
    if !path.exists() {
        // Try migration from agent.json — ensure directory exists with 0700
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
            }
        }
        let agent_config = config::load_config();
        if let Ok(cfg) = agent_config {
            let ip = cfg
                .panel_url
                .replace("https://", "")
                .replace("http://", "")
                .split(':')
                .next()
                .unwrap_or("")
                .to_string();

            let entry = ServerEntry {
                id: uuid::Uuid::new_v4().to_string(),
                label: cfg.domain.clone().unwrap_or_else(|| ip.clone()),
                panel_url: cfg.panel_url,
                ip,
                domain: cfg.domain,
                provider: None,
                provider_id: None,
                region: None,
                created_at: cfg.setup_at.unwrap_or_default(),
                active: true,
                auth_method: cfg.auth_method,
                keychain_identity: cfg.keychain_identity,
                p12_path: cfg.p12_path,
                p12_password: cfg.p12_password,
                admin_auth: None,
            };

            let mut entries = vec![entry];
            save_servers_registry(&path, &entries)?;
            // Migrate P12 password to credential store
            migrate_p12_passwords(&mut entries, &path)?;

            return Ok(entries);
        }

        return Ok(vec![]);
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read servers.json: {}", e))?;
    let mut servers: Vec<ServerEntry> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse servers.json: {}", e))?;
    // Migrate any remaining plaintext P12 passwords to credential store
    migrate_p12_passwords(&mut servers, &path)?;
    Ok(servers)
}

#[tauri::command]
pub async fn get_servers() -> Result<Vec<ServerEntry>, String> {
    tokio::task::spawn_blocking(|| {
        let body = curl_agentd("GET", "/api/servers", None)?;
        let parsed: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse servers response: {}", e))?;
        let servers_val = parsed
            .get("servers")
            .ok_or_else(|| "Missing 'servers' in response".to_string())?;
        serde_json::from_value::<Vec<ServerEntry>>(servers_val.clone())
            .map_err(|e| format!("Failed to deserialize servers: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn set_active_server(server_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let payload = serde_json::json!({ "id": server_id });
        curl_agentd("PATCH", "/api/servers/active", Some(&payload.to_string()))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn add_managed_server(
    panel_url: String,
    label: String,
) -> Result<ServerEntry, String> {
    // Validate inputs before making any requests
    validate_label(&label)?;
    validate_panel_url(&panel_url)?;

    // Verify panel is reachable via health check (no mTLS needed for health)
    let health_url = format!("{}/api/health", panel_url.trim_end_matches('/'));
    let panel_url_ref = panel_url.clone();
    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new("curl")
            .args([
                "-s", "-f", "--max-time", "10", "-k",
                "--proto", "=https",
                &health_url,
            ])
            .output()
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
    .map_err(|e| format!("Failed to check panel health: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Panel at {} is not reachable. Verify the URL and try again.",
            panel_url_ref
        ));
    }

    let ip = panel_url_ref
        .replace("https://", "")
        .split(':')
        .next()
        .unwrap_or("")
        .to_string();

    let entry = ServerEntry {
        id: uuid::Uuid::new_v4().to_string(),
        label,
        panel_url: panel_url_ref.trim_end_matches('/').to_string(),
        ip,
        domain: None,
        provider: None,
        provider_id: None,
        region: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        active: false,
        auth_method: "p12".to_string(),
        keychain_identity: None,
        p12_path: None,
        p12_password: None,
        admin_auth: None,
    };

    // Add to registry (blocking I/O wrapped in spawn_blocking)
    let entry_clone = entry.clone();
    tokio::task::spawn_blocking(move || {
        let path = config::servers_registry_path();
        let dir = path.parent().unwrap();
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| format!("Failed to set directory permissions: {}", e))?;
        }

        let mut servers: Vec<ServerEntry> = if path.exists() {
            let content = std::fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read: {}", e))?;
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            vec![]
        };

        servers.push(entry_clone);
        save_servers_registry(&path, &servers)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    Ok(entry)
}

#[tauri::command]
pub async fn remove_server(server_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        // Remove from registry via agentd REST API
        // (handles registry update + server directory cleanup)
        let path = format!("/api/servers/{}", server_id);
        curl_agentd("DELETE", &path, None)?;

        // Clean up credentials from OS keychain (must stay in Rust)
        let _ = credentials::delete_server_credential(&server_id);
        let _ = credentials::delete_admin_credential(&server_id);
        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

// ---------------------------------------------------------------------------
// Server health check
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn check_server_health(server_id: String) -> Result<ServerHealth, String> {
    let server_id_clone = server_id.clone();
    let server = tokio::task::spawn_blocking(move || {
        let servers = load_servers_registry()?;
        servers
            .into_iter()
            .find(|s| s.id == server_id_clone)
            .ok_or_else(|| "Server not found".to_string())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    // Validate stored URL before making requests
    validate_panel_url(&server.panel_url)?;
    let health_url = format!("{}/api/health", server.panel_url);

    // Build admin cert args for mTLS — nginx requires a client cert even
    // though the panel exempts /api/health from mTLS validation.
    let admin_cfg = tokio::task::spawn_blocking(move || {
        build_server_admin_config(&server_id, &server)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;

    let result = tokio::task::spawn_blocking(move || {
        let mut args = vec![
            "-s".to_string(), "-f".to_string(),
            "--max-time".to_string(), "10".to_string(),
            "-k".to_string(),
            "--proto".to_string(), "=https".to_string(),
        ];

        // Attach client cert if available (required for nginx mTLS)
        let _auth_guard;
        if let Ok(cfg) = &admin_cfg {
            if let Ok(auth) = crate::api::build_curl_auth_for_server(cfg) {
                args.extend(auth.auth_args());
                _auth_guard = Some(auth);
            }
        }

        args.push(health_url);

        std::process::Command::new("curl")
            .args(&args)
            .output()
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;

    match result {
        Ok(output) if output.status.success() => {
            let body = String::from_utf8_lossy(&output.stdout);
            let status = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| v.get("status").and_then(|s| s.as_str()).map(String::from));
            Ok(ServerHealth {
                online: true,
                status,
            })
        }
        _ => Ok(ServerHealth {
            online: false,
            status: None,
        }),
    }
}

// ---------------------------------------------------------------------------
// Storage server commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn store_storage_credentials(
    access_key: String,
    secret_key: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let creds = StorageCredentials {
            access_key,
            secret_key,
        };
        let json = serde_json::to_string(&creds)
            .map_err(|e| format!("Failed to serialize credentials: {}", e))?;
        credentials::store_storage_credential("spaces", &json)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn get_storage_credentials() -> Result<bool, String> {
    tokio::task::spawn_blocking(|| {
        Ok(credentials::get_storage_credential("spaces")?
            .is_some())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn delete_storage_credentials() -> Result<(), String> {
    tokio::task::spawn_blocking(|| credentials::delete_storage_credential("spaces"))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn validate_storage_credentials(
    access_key: String,
    secret_key: String,
) -> Result<(), String> {
    // If no credentials provided, load from keychain
    let (effective_ak, effective_sk) = if access_key.is_empty() || secret_key.is_empty() {
        let creds = tokio::task::spawn_blocking(load_storage_credentials)
            .await
            .map_err(|e| format!("Task failed: {}", e))??;
        (creds.access_key, creds.secret_key)
    } else {
        (access_key, secret_key)
    };

    tokio::task::spawn_blocking(move || {
        run_storage_cmd(&["validate-spaces"], &effective_ak, &effective_sk)?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn get_spaces_regions() -> Result<Vec<SpacesRegion>, String> {
    tokio::task::spawn_blocking(|| {
        let output = run_cloud_cmd_no_credentials(&["spaces-regions"])?;
        serde_json::from_str::<Vec<SpacesRegion>>(output.trim())
            .map_err(|e| format!("Failed to parse Spaces regions: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn provision_storage_server(
    app_handle: tauri::AppHandle,
    region: String,
    label: String,
    bucket: Option<String>,
) -> Result<StorageServerEntry, String> {
    validate_label(&label)?;
    validate_spaces_region(&region)?;
    if let Some(ref b) = bucket {
        if !b.is_empty() {
            validate_bucket_name(b)?;
        }
    }

    let creds = tokio::task::spawn_blocking(load_storage_credentials)
        .await
        .map_err(|e| format!("Task failed: {}", e))??;

    tokio::task::spawn_blocking(move || {
        let cli_path = cloud_cli_path();

        let mut args = vec![
            "provision-storage".to_string(),
            "--region".to_string(),
            region,
            "--label".to_string(),
            label,
        ];
        if let Some(b) = bucket {
            if !b.is_empty() {
                args.push("--bucket".to_string());
                args.push(b);
            }
        }

        let mut child = std::process::Command::new("node")
            .arg(&cli_path)
            .args(&args)
            .env("LAMALIBRE_SPACES_ACCESS_KEY", &creds.access_key)
            .env("LAMALIBRE_SPACES_SECRET_KEY", &creds.secret_key)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn storage provisioner: {}", e))?;

        let stdout = child.stdout.take().ok_or("No stdout")?;
        let reader = std::io::BufReader::new(stdout);
        let mut last_storage_server: Option<StorageServerEntry> = None;
        let mut last_error: Option<String> = None;

        for line in reader.lines() {
            let line = line.map_err(|e| format!("Read error: {}", e))?;
            if line.trim().is_empty() {
                continue;
            }

            if let Ok(progress) = serde_json::from_str::<StorageProvisionProgress>(&line) {
                match progress.event.as_str() {
                    "complete" => {
                        last_storage_server = progress.storage_server;
                    }
                    "error" => {
                        last_error = progress.message.clone();
                        if let Some(ref step) = progress.step {
                            let _ = app_handle.emit("storage-provision-progress", serde_json::json!({
                                "step": step,
                                "status": "failed",
                            }));
                        }
                    }
                    "step" => {
                        if let (Some(ref step), Some(ref status)) = (&progress.step, &progress.status) {
                            let _ = app_handle.emit("storage-provision-progress", serde_json::json!({
                                "step": step,
                                "status": status,
                            }));
                        }
                    }
                    _ => {}
                }
            }
        }

        let status = child
            .wait()
            .map_err(|e| format!("Failed to wait for storage provisioner: {}", e))?;

        if !status.success() {
            if let Some(err) = last_error {
                return Err(format!("Storage provisioning failed: {}", err));
            }
            return Err("Storage provisioning failed".to_string());
        }

        last_storage_server
            .ok_or_else(|| "Storage provisioning completed but no entry returned".to_string())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn get_storage_servers() -> Result<Vec<StorageServerEntry>, String> {
    tokio::task::spawn_blocking(|| {
        let body = curl_agentd("GET", "/api/storage-servers", None)?;
        let parsed: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse storage-servers response: {}", e))?;
        let servers_val = parsed
            .get("servers")
            .ok_or_else(|| "Missing 'servers' in response".to_string())?;
        serde_json::from_value::<Vec<StorageServerEntry>>(servers_val.clone())
            .map_err(|e| format!("Failed to deserialize storage servers: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn remove_storage_server(server_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let path = config::storage_servers_registry_path();
        if !path.exists() {
            return Err("No storage servers registered".to_string());
        }

        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read: {}", e))?;
        let servers: Vec<StorageServerEntry> = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse: {}", e))?;

        let original_len = servers.len();
        let filtered: Vec<StorageServerEntry> =
            servers.into_iter().filter(|s| s.id != server_id).collect();

        if filtered.len() == original_len {
            return Err("Storage server not found".to_string());
        }

        save_storage_servers_registry(&path, &filtered)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn destroy_storage_server(server_id: String) -> Result<(), String> {
    let server_id_for_read = server_id.clone();

    // Verify the entry exists before attempting destruction
    tokio::task::spawn_blocking(move || {
        let path = config::storage_servers_registry_path();
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read storage-servers.json: {}", e))?;
        let servers: Vec<StorageServerEntry> = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse storage-servers.json: {}", e))?;
        servers
            .iter()
            .find(|s| s.id == server_id_for_read)
            .ok_or_else(|| "Storage server not found".to_string())?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    let creds = tokio::task::spawn_blocking(load_storage_credentials)
        .await
        .map_err(|e| format!("Task failed: {}", e))??;

    // The destroy-storage CLI command deletes the bucket AND removes the
    // entry from the registry, so no additional cleanup is needed here.
    tokio::task::spawn_blocking(move || {
        run_storage_cmd(
            &["destroy-storage", "--id", &server_id],
            &creds.access_key,
            &creds.secret_key,
        )?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Atomically save the storage servers registry with fsync before rename.
fn save_storage_servers_registry(
    path: &std::path::Path,
    servers: &[StorageServerEntry],
) -> Result<(), String> {
    let json = serde_json::to_string_pretty(servers)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    let tmp_path = path.with_extension("json.tmp");

    {
        let mut file = File::create(&tmp_path)
            .map_err(|e| format!("Failed to create temp file: {}", e))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("Failed to write temp file: {}", e))?;
        file.sync_all()
            .map_err(|e| format!("Failed to fsync temp file: {}", e))?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Failed to set permissions: {}", e))?;
    }

    std::fs::rename(&tmp_path, path)
        .map_err(|e| format!("Failed to save registry: {}", e))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Server health check
// ---------------------------------------------------------------------------

/// Build admin API config for a specific server (not necessarily the active one).
fn build_server_admin_config(
    server_id: &str,
    server: &ServerEntry,
) -> Result<config::AdminApiConfig, String> {
    let auth_method = server.auth_method.clone();
    let p12_path = server.p12_path.clone();
    let keychain_identity = server.keychain_identity.clone();

    let mut p12_password = None;
    if auth_method == "p12" {
        if let Ok(Some(pw)) = crate::credentials::get_server_credential(server_id) {
            p12_password = Some(pw);
        }
    }

    Ok(config::AdminApiConfig {
        panel_url: server.panel_url.clone(),
        auth_method,
        p12_path,
        p12_password,
        keychain_identity,
    })
}

// ---------------------------------------------------------------------------
// Plugin storage binding
// ---------------------------------------------------------------------------

/// Helper: make an admin API call to a panel identified by label.
fn admin_api_for_label(
    label: &str,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<serde_json::Value, String> {
    let cfg = config::load_admin_config_for_label(label)?;
    let resp = crate::api::curl_panel_admin(&cfg, method, path, body)?;
    serde_json::from_str(&resp).map_err(|e| {
        let safe_body = if resp.len() <= 200 {
            resp.clone()
        } else {
            let end = resp
                .char_indices()
                .take_while(|(i, _)| *i < 200)
                .last()
                .map(|(i, c)| i + c.len_utf8())
                .unwrap_or(0);
            format!("{}...(truncated)", &resp[..end])
        };
        format!("Failed to parse response: {} — body: {}", e, safe_body)
    })
}

/// Push a storage server's credentials to a panel server.
/// Loads the storage server entry from the local registry and credentials from
/// the OS keychain, then POSTs them to the target panel's storage API.
#[tauri::command]
pub async fn push_storage_to_panel(
    server_id: String,
    panel_label: String,
) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        // 1. Load storage server entry from local registry
        let path = config::storage_servers_registry_path();
        if !path.exists() {
            return Err("No storage servers configured".to_string());
        }
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read storage-servers.json: {}", e))?;
        let entries: Vec<StorageServerEntry> = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse storage-servers.json: {}", e))?;
        let entry = entries
            .into_iter()
            .find(|e| e.id == server_id)
            .ok_or_else(|| format!("Storage server \"{}\" not found in local registry", server_id))?;

        // 2. Load credentials from OS keychain
        let creds = load_storage_credentials()?;

        // 3. POST to panel
        let body = serde_json::json!({
            "id": entry.id,
            "label": entry.label,
            "provider": entry.provider,
            "region": entry.region,
            "bucket": entry.bucket,
            "endpoint": entry.endpoint,
            "accessKey": creds.access_key,
            "secretKey": creds.secret_key,
        })
        .to_string();

        admin_api_for_label(&panel_label, "POST", "/api/storage/servers", Some(&body))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Bind a storage server to a plugin on a specific panel server.
#[tauri::command]
pub async fn bind_plugin_storage(
    panel_label: String,
    plugin_name: String,
    storage_server_id: String,
) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let body = serde_json::json!({
            "pluginName": plugin_name,
            "storageServerId": storage_server_id,
        })
        .to_string();

        admin_api_for_label(&panel_label, "POST", "/api/storage/bindings", Some(&body))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

// ---------------------------------------------------------------------------
// Panel server update
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelUpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub installer_version: String,
    pub has_update: bool,
}

/// Check whether a panel server update is available.
///
/// Fetches the running serverd version from /api/health, then
/// queries the npm registry for the latest published versions of
/// both @lamalibre/lamaste-serverd (for display) and
/// @lamalibre/create-lamaste (for install).
#[tauri::command]
pub async fn check_panel_update(server_id: String) -> Result<PanelUpdateInfo, String> {
    // Fetch current version from health endpoint
    let current_version = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let servers = load_servers_registry()?;
        let server = servers.iter().find(|s| s.id == server_id)
            .ok_or("Server not found")?;

        validate_panel_url(&server.panel_url)?;
        let health_url = format!("{}/api/health", server.panel_url);

        let admin_cfg = build_server_admin_config(&server.id, server);

        let mut args = vec![
            "-s".to_string(), "-f".to_string(),
            "--max-time".to_string(), "10".to_string(),
            "-k".to_string(),
            "--proto".to_string(), "=https".to_string(),
        ];

        let _auth_guard;
        if let Ok(cfg) = &admin_cfg {
            if let Ok(auth) = crate::api::build_curl_auth_for_server(cfg) {
                args.extend(auth.auth_args());
                _auth_guard = Some(auth);
            }
        }

        args.push(health_url);

        let output = std::process::Command::new("curl")
            .args(&args)
            .output()
            .map_err(|e| format!("Failed to run curl: {}", e))?;

        if !output.status.success() {
            return Err("Server is offline".to_string());
        }

        let body = String::from_utf8_lossy(&output.stdout);
        let parsed: serde_json::Value = serde_json::from_str(&body)
            .map_err(|_| "Invalid health response".to_string())?;

        Ok(parsed.get("version")
            .and_then(|v| v.as_str())
            .unwrap_or("0.0.0")
            .to_string())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    // Get latest versions from npm registry
    let (latest_panel_version, installer_version) = tokio::task::spawn_blocking(|| -> Result<(String, String), String> {
        let panel_output = std::process::Command::new("npm")
            .args(["view", "@lamalibre/lamaste-serverd", "version", "--json", "--prefer-online"])
            .output()
            .map_err(|e| format!("Failed to run npm: {}", e))?;

        let panel_ver = if panel_output.status.success() {
            let raw = String::from_utf8_lossy(&panel_output.stdout);
            raw.trim().trim_matches('"').to_string()
        } else {
            "0.0.0".to_string()
        };

        let installer_output = std::process::Command::new("npm")
            .args(["view", "@lamalibre/create-lamaste", "version", "--json", "--prefer-online"])
            .output()
            .map_err(|e| format!("Failed to run npm: {}", e))?;

        let installer_ver = if installer_output.status.success() {
            let raw = String::from_utf8_lossy(&installer_output.stdout);
            raw.trim().trim_matches('"').to_string()
        } else {
            "0.0.0".to_string()
        };

        Ok((panel_ver, installer_ver))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    let has_update = current_version != latest_panel_version && latest_panel_version != "0.0.0";

    Ok(PanelUpdateInfo {
        current_version,
        latest_version: latest_panel_version,
        installer_version,
        has_update,
    })
}

/// Update a panel server to a specific create-lamaste version.
///
/// Sends POST /api/system/update to the panel server, which spawns a
/// detached update script (stop → npx create-lamaste@version → start).
/// Then polls /api/health until the server comes back online.
#[tauri::command]
pub async fn update_panel_server(
    app: tauri::AppHandle,
    server_id: String,
    version: String,
) -> Result<(), String> {
    let server_id_clone = server_id.clone();
    let version_clone = version.clone();

    // Step 1: Send update request to panel
    let _ = app.emit("panel-update-progress", serde_json::json!({
        "step": "update_panel",
        "status": "running",
    }));

    let panel_url = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let servers = load_servers_registry()?;
        let server = servers.iter().find(|s| s.id == server_id_clone)
            .ok_or("Server not found")?;
        validate_panel_url(&server.panel_url)?;

        let update_url = format!("{}/api/system/update", server.panel_url);
        let admin_cfg = build_server_admin_config(&server.id, server)?;
        let auth = crate::api::build_curl_auth_for_server(&admin_cfg)
            .map_err(|e| format!("Auth error: {}", e))?;

        let body = serde_json::json!({ "version": version_clone }).to_string();

        let mut args = vec![
            "-s".to_string(), "-f".to_string(),
            "--max-time".to_string(), "30".to_string(),
            "-k".to_string(),
            "--proto".to_string(), "=https".to_string(),
            "-X".to_string(), "POST".to_string(),
            "-H".to_string(), "Content-Type: application/json".to_string(),
            "-d".to_string(), body,
        ];
        args.extend(auth.auth_args());
        args.push(update_url.clone());

        let output = std::process::Command::new("curl")
            .args(&args)
            .output()
            .map_err(|e| format!("Failed to run curl: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            return Err(format!("Update request failed: {} {}", stderr, stdout));
        }

        Ok(server.panel_url.clone())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    let _ = app.emit("panel-update-progress", serde_json::json!({
        "step": "update_panel",
        "status": "done",
    }));

    // Step 2: Poll health until server comes back with new version
    let _ = app.emit("panel-update-progress", serde_json::json!({
        "step": "verify_health",
        "status": "running",
    }));

    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let max_retries = 40; // 40 * 5s = ~3.5 minutes
        let retry_delay = std::time::Duration::from_secs(5);

        // Wait a few seconds for the panel to start shutting down
        std::thread::sleep(std::time::Duration::from_secs(5));

        let servers = load_servers_registry()?;
        let server = servers.iter().find(|s| s.id == server_id)
            .ok_or("Server not found")?;

        for i in 0..max_retries {
            let admin_cfg = build_server_admin_config(&server.id, server);
            let health_url = format!("{}/api/health", panel_url);

            let mut args = vec![
                "-s".to_string(), "-f".to_string(),
                "--max-time".to_string(), "10".to_string(),
                "-k".to_string(),
                "--proto".to_string(), "=https".to_string(),
            ];

            let _auth_guard;
            if let Ok(cfg) = &admin_cfg {
                if let Ok(auth) = crate::api::build_curl_auth_for_server(cfg) {
                    args.extend(auth.auth_args());
                    _auth_guard = Some(auth);
                }
            }

            args.push(health_url);

            if let Ok(output) = std::process::Command::new("curl").args(&args).output() {
                if output.status.success() {
                    let body = String::from_utf8_lossy(&output.stdout);
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&body) {
                        if parsed.get("status").and_then(|s| s.as_str()) == Some("ok") {
                            let _ = app_clone.emit("panel-update-progress", serde_json::json!({
                                "step": "verify_health",
                                "status": "done",
                            }));
                            let _ = app_clone.emit("panel-update-progress", serde_json::json!({
                                "step": "complete",
                                "status": "done",
                            }));
                            return Ok(());
                        }
                    }
                }
            }

            if i < max_retries - 1 {
                std::thread::sleep(retry_delay);
            }
        }

        Err("Panel server did not come back online after update".to_string())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Convenience command: push storage server to panel (idempotent) then bind to plugin.
#[tauri::command]
pub async fn setup_plugin_storage(
    panel_label: String,
    plugin_name: String,
    storage_server_id: String,
) -> Result<serde_json::Value, String> {
    let pl = panel_label.clone();
    let sid = storage_server_id.clone();

    // Step 1: Push storage server (skip if 409 = already registered)
    let push_result = push_storage_to_panel(sid.clone(), pl.clone()).await;
    match &push_result {
        Ok(_) => {}
        Err(e) if e.contains("409") => {
            // Already registered — that's fine, continue to bind
        }
        Err(e) => return Err(format!("Failed to push storage server: {}", e)),
    }

    // Step 2: Bind to plugin
    bind_plugin_storage(panel_label, plugin_name, storage_server_id).await
}

// ---------------------------------------------------------------------------
// SSH recovery commands
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryKeyPair {
    pub public_key: String,
    pub private_key_path: String,
    pub known_hosts_path: String,
    pub dir: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryResult {
    pub p12_path: String,
    pub p12_password: String,
}

/// Generate an ephemeral SSH key pair for admin certificate recovery.
#[tauri::command]
pub async fn generate_recovery_ssh_key() -> Result<RecoveryKeyPair, String> {
    tokio::task::spawn_blocking(|| {
        let output = run_cloud_cmd_no_credentials(&["recover-generate-key"])?;
        serde_json::from_str::<RecoveryKeyPair>(output.trim())
            .map_err(|e| format!("Failed to parse recovery key pair: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Test SSH connectivity to a server using the recovery SSH key.
#[tauri::command]
pub async fn test_recovery_ssh(
    ip: String,
    private_key_path: String,
    known_hosts_path: String,
) -> Result<(), String> {
    // Validate IP is not empty and not a private address
    if ip.is_empty() {
        return Err("IP address is required".to_string());
    }

    tokio::task::spawn_blocking(move || {
        let output = run_cloud_cmd_no_credentials(&[
            "recover-test-ssh",
            "--ip", &ip,
            "--key", &private_key_path,
            "--known-hosts", &known_hosts_path,
        ])?;
        // Command succeeds if SSH is reachable
        let _: serde_json::Value = serde_json::from_str(output.trim())
            .map_err(|e| format!("Unexpected output: {}", e))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Reset the admin certificate on the server via SSH and download the new P12.
#[tauri::command]
pub async fn recover_admin_via_ssh(
    ip: String,
    private_key_path: String,
    known_hosts_path: String,
) -> Result<RecoveryResult, String> {
    if ip.is_empty() {
        return Err("IP address is required".to_string());
    }

    tokio::task::spawn_blocking(move || {
        let output = run_cloud_cmd_no_credentials(&[
            "recover-admin",
            "--ip", &ip,
            "--key", &private_key_path,
            "--known-hosts", &known_hosts_path,
        ])?;
        serde_json::from_str::<RecoveryResult>(output.trim())
            .map_err(|e| format!("Failed to parse recovery result: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Clean up the ephemeral SSH key pair and any downloaded recovery files.
#[tauri::command]
pub async fn cleanup_recovery_ssh_key(dir: String) -> Result<(), String> {
    if dir.is_empty() {
        return Err("Directory path is required".to_string());
    }

    // Validate the dir is under <agent_dir>/tmp/ to prevent path traversal
    let expected_prefix = crate::config::agent_dir().join("tmp");
    let dir_path = std::path::Path::new(&dir);
    // Canonicalize to resolve any .. components before checking prefix
    let canonical_dir = dir_path.canonicalize()
        .map_err(|_| "Recovery directory does not exist or cannot be resolved".to_string())?;
    let canonical_prefix = expected_prefix.canonicalize()
        .map_err(|_| "Base tmp directory does not exist".to_string())?;
    if !canonical_dir.starts_with(&canonical_prefix) {
        return Err(format!(
            "Recovery directory must be under {}",
            expected_prefix.display()
        ));
    }

    // Pass the canonical path to eliminate TOCTOU between validation and use
    let canonical_dir_str = canonical_dir.to_string_lossy().to_string();
    tokio::task::spawn_blocking(move || {
        run_cloud_cmd_no_credentials(&["recover-cleanup", "--dir", &canonical_dir_str])?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}
