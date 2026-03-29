/// Cloud provisioning Tauri commands.
///
/// These commands bridge the React UI to the `@lamalibre/portlama-cloud`
/// Node.js package. Cloud API tokens are stored in the OS credential store
/// and passed to Node.js via environment variables (never CLI args).
use crate::config;
use crate::credentials;

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

/// Resolve the path to the portlama-cloud CLI entry point.
/// Uses the workspace path (CARGO_MANIFEST_DIR is baked at compile time),
/// then falls back to PATH lookup.
fn cloud_cli_path() -> PathBuf {
    // CARGO_MANIFEST_DIR is set at compile time — works in both debug and release
    let workspace_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../portlama-cloud/bin/portlama-cloud.js");
    if let Ok(canonical) = workspace_path.canonicalize() {
        if canonical.exists() {
            return canonical;
        }
    }

    // Fallback: assume portlama-cloud is in PATH
    PathBuf::from("portlama-cloud")
}

/// Run a portlama-cloud CLI command and return the stdout output.
fn run_cloud_cmd(
    args: &[&str],
    token: &str,
) -> Result<String, String> {
    let cli_path = cloud_cli_path();

    let output = std::process::Command::new("node")
        .arg(&cli_path)
        .args(args)
        .env("PORTLAMA_CLOUD_TOKEN", token)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn portlama-cloud: {}", e))?
        .wait_with_output()
        .map_err(|e| format!("Failed to run portlama-cloud: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "portlama-cloud {} failed: {}{}",
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
            .env("PORTLAMA_CLOUD_TOKEN", &token)
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
fn redact_servers(mut servers: Vec<ServerEntry>) -> Vec<ServerEntry> {
    for s in &mut servers {
        s.p12_password = None;
    }
    servers
}

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
        let servers = load_servers_registry()?;
        Ok(redact_servers(servers))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn set_active_server(server_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let path = config::servers_registry_path();
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read servers.json: {}", e))?;
        let mut servers: Vec<ServerEntry> = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse servers.json: {}", e))?;

        let mut found = false;
        for s in &mut servers {
            s.active = s.id == server_id;
            if s.id == server_id {
                found = true;
            }
        }

        if !found {
            return Err("Server not found".to_string());
        }

        save_servers_registry(&path, &servers)
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
        let path = config::servers_registry_path();
        if !path.exists() {
            return Err("No servers registered".to_string());
        }

        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read: {}", e))?;
        let servers: Vec<ServerEntry> = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse: {}", e))?;

        let original_len = servers.len();
        let filtered: Vec<ServerEntry> =
            servers.into_iter().filter(|s| s.id != server_id).collect();

        if filtered.len() == original_len {
            return Err("Server not found".to_string());
        }

        save_servers_registry(&path, &filtered)?;
        // Clean up P12 password from credential store
        let _ = credentials::delete_server_credential(&server_id);
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
