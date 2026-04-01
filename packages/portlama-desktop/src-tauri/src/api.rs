use crate::config;

// --- Curl config file helper (keeps P12 password out of process args) ---

/// RAII guard that creates a temporary curl config file with cert credentials
/// and deletes it on drop, ensuring cleanup even on error paths.
struct CurlConfigFile {
    path: std::path::PathBuf,
}

impl CurlConfigFile {
    fn new(p12_path: &str, p12_password: &str) -> Result<Self, String> {
        use std::io::Write;

        let random_suffix: u64 = {
            use std::collections::hash_map::RandomState;
            use std::hash::{BuildHasher, Hasher};
            let s = RandomState::new();
            let mut h = s.build_hasher();
            h.write_u8(0);
            h.finish()
        };

        // Validate that p12_password and p12_path don't contain characters that
        // could inject additional curl config directives. In curl's config file format,
        // newlines terminate a directive, so embedded newlines/carriage returns/null bytes
        // in the value would allow injection of arbitrary curl options.
        if p12_password.contains('\n')
            || p12_password.contains('\r')
            || p12_password.contains('\0')
        {
            return Err("P12 password contains invalid characters".to_string());
        }
        if p12_path.contains('\n')
            || p12_path.contains('\r')
            || p12_path.contains('\0')
        {
            return Err("P12 path contains invalid characters".to_string());
        }

        let dir = config::agent_dir();
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create agent directory: {}", e))?;

        let path = dir.join(format!(".curl-config-{}.tmp", random_suffix));

        // Build config content: quote the cert path:password to handle special chars.
        // Curl config files use \"  for literal quote and \\ for literal backslash.
        let content = format!(
            "cert = \"{}:{}\"\ncert-type = \"P12\"\n",
            p12_path.replace('\\', "\\\\").replace('"', "\\\""),
            p12_password.replace('\\', "\\\\").replace('"', "\\\""),
        );

        // Create file atomically with restrictive permissions and O_EXCL
        // to prevent symlink attacks and avoid a window of world-readable content
        {
            #[cfg(unix)]
            let mut file = {
                use std::os::unix::fs::OpenOptionsExt;
                std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .open(&path)
                    .map_err(|e| format!("Failed to create curl config file: {}", e))?
            };

            #[cfg(not(unix))]
            let mut file = {
                std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&path)
                    .map_err(|e| format!("Failed to create curl config file: {}", e))?
            };

            file.write_all(content.as_bytes())
                .map_err(|e| format!("Failed to write curl config file: {}", e))?;
        }

        Ok(Self { path })
    }
}

impl Drop for CurlConfigFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

// --- Shared curl helpers ---

/// Build auth-specific curl args. For P12, creates a temp config file (RAII).
/// For Keychain, returns --cert <identity> args directly.
pub(crate) enum CurlAuth {
    P12(CurlConfigFile),
    Keychain(String),
}

impl CurlAuth {
    fn new(cfg: &config::AgentConfig) -> Result<Self, String> {
        if cfg.auth_method == "keychain" {
            let identity = cfg.keychain_identity.as_deref()
                .ok_or("Keychain identity not configured")?;
            Ok(CurlAuth::Keychain(identity.to_string()))
        } else {
            let p12_path = cfg.p12_path.as_deref()
                .ok_or("P12 path not configured")?;
            let p12_password = cfg.p12_password.as_deref()
                .ok_or("P12 password not configured")?;
            Ok(CurlAuth::P12(CurlConfigFile::new(p12_path, p12_password)?))
        }
    }

    pub(crate) fn auth_args(&self) -> Vec<String> {
        match self {
            CurlAuth::P12(cfg_file) => vec![
                "-K".to_string(),
                cfg_file.path.to_string_lossy().to_string(),
            ],
            CurlAuth::Keychain(identity) => vec![
                "--cert".to_string(),
                identity.clone(),
            ],
        }
    }
}

/// Build a CurlAuth for a server's admin config (for use in health checks etc.).
/// The returned CurlAuth must be kept alive until the curl command completes
/// (it holds the RAII guard for the temp config file).
pub(crate) fn build_curl_auth_for_server(cfg: &config::AdminApiConfig) -> Result<CurlAuth, String> {
    admin_curl_auth(cfg)
}

pub(crate) fn curl_panel(
    cfg: &config::AgentConfig,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<String, String> {
    let url = format!("{}{}", cfg.panel_url.trim_end_matches('/'), path);
    let auth = CurlAuth::new(cfg)?;

    let mut args = vec!["-s".to_string()];
    args.extend(auth.auth_args());
    args.extend([
        "-k".to_string(),
        "-X".to_string(),
        method.to_string(),
    ]);

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

    // auth is dropped here (or on early return), cleaning up temp files if P12

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Request failed: {}", stderr));
    }

    let body = String::from_utf8_lossy(&output.stdout).to_string();

    // Check if response contains a JSON error from the panel
    if let Ok(err_obj) = serde_json::from_str::<serde_json::Value>(&body) {
        if let Some(error) = err_obj.get("error").and_then(|e| e.as_str()) {
            return Err(error.to_string());
        }
    }

    Ok(body)
}

/// Curl the agent's local panel server (plain HTTP on 127.0.0.1).
///
/// The agent panel server trusts nginx to handle mTLS. Since the desktop app
/// runs on the same machine, we can reach it directly via localhost and pass
/// the identity via X-SSL-Client-Verify/X-SSL-Client-DN headers — the same
/// headers nginx would set after a successful mTLS handshake.
///
/// This is safe because the panel server binds to 127.0.0.1 only.
pub(crate) fn curl_agent_local_panel(
    agent_label: &str,
    port: u16,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<String, String> {
    let url = format!("http://127.0.0.1:{}{}", port, path);

    let mut args = vec![
        "-s".to_string(),
        "-H".to_string(),
        "X-SSL-Client-Verify: SUCCESS".to_string(),
        "-H".to_string(),
        format!("X-SSL-Client-DN: CN=agent:{}", agent_label),
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
        return Err(format!("Request failed: {}", stderr));
    }

    let body = String::from_utf8_lossy(&output.stdout).to_string();

    if let Ok(err_obj) = serde_json::from_str::<serde_json::Value>(&body) {
        if let Some(error) = err_obj.get("error").and_then(|e| e.as_str()) {
            return Err(error.to_string());
        }
    }

    Ok(body)
}

pub(crate) fn curl_panel_binary(
    cfg: &config::AgentConfig,
    path: &str,
    output_path: &std::path::Path,
) -> Result<(), String> {
    let url = format!("{}{}", cfg.panel_url.trim_end_matches('/'), path);
    let auth = CurlAuth::new(cfg)?;

    let mut args = vec!["-s".to_string()];
    args.extend(auth.auth_args());
    args.extend([
        "-k".to_string(),
        "-o".to_string(),
        output_path.to_string_lossy().to_string(),
        url,
    ]);

    let output = std::process::Command::new("curl")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run curl: {}", e))?;

    // auth is dropped here, cleaning up temp files if P12

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Download failed: {}", stderr));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Admin API helpers — use admin certificate instead of agent certificate
// ---------------------------------------------------------------------------

use std::sync::Mutex;
use std::collections::HashMap;
use std::time::Instant;

/// In-process storage for 2FA session cookies (keyed by server ID).
/// Value is (cookie_value, expiry_instant).
static SESSION_STORE: std::sync::LazyLock<Mutex<HashMap<String, (String, Instant)>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// Store a 2FA session cookie for a server.
pub(crate) fn store_2fa_session(server_id: &str, cookie: &str, ttl_seconds: u64) {
    let expiry = Instant::now() + std::time::Duration::from_secs(ttl_seconds);
    let mut store = SESSION_STORE.lock().unwrap();
    store.insert(server_id.to_string(), (cookie.to_string(), expiry));
}

/// Get the 2FA session cookie for a server, if still valid.
pub(crate) fn get_2fa_session(server_id: &str) -> Option<String> {
    let mut store = SESSION_STORE.lock().unwrap();
    if let Some((cookie, expiry)) = store.get(server_id) {
        if Instant::now() < *expiry {
            return Some(cookie.clone());
        }
        store.remove(server_id);
    }
    None
}

/// Build a CurlAuth from an AdminApiConfig.
fn admin_curl_auth(cfg: &config::AdminApiConfig) -> Result<CurlAuth, String> {
    if cfg.auth_method == "keychain" {
        let identity = cfg.keychain_identity.as_deref()
            .ok_or("Admin keychain identity not configured")?;
        Ok(CurlAuth::Keychain(identity.to_string()))
    } else {
        let p12_path = cfg.p12_path.as_deref()
            .ok_or("Admin P12 path not configured")?;
        let p12_password = cfg.p12_password.as_deref()
            .ok_or("Admin P12 password not configured")?;
        Ok(CurlAuth::P12(CurlConfigFile::new(p12_path, p12_password)?))
    }
}

/// Make an admin API request to the panel.
/// Includes the 2FA session cookie if one is stored for the active server.
pub(crate) fn curl_panel_admin(
    cfg: &config::AdminApiConfig,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<String, String> {
    let url = format!("{}{}", cfg.panel_url.trim_end_matches('/'), path);
    let auth = admin_curl_auth(cfg)?;

    let mut args = vec!["-s".to_string()];
    args.extend(auth.auth_args());
    args.extend([
        "-k".to_string(),
        "-X".to_string(),
        method.to_string(),
    ]);

    // Include 2FA session cookie if available (validated against injection)
    if let Ok(server_id) = config::get_active_server_id() {
        if let Some(cookie) = get_2fa_session(&server_id) {
            if cookie.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'%') {
                args.push("-b".to_string());
                args.push(format!("portlama_2fa_session={}", cookie));
            }
        }
    }

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
        return Err(format!("Request failed: {}", stderr));
    }

    let body = String::from_utf8_lossy(&output.stdout).to_string();

    if let Ok(err_obj) = serde_json::from_str::<serde_json::Value>(&body) {
        if let Some(error) = err_obj.get("error").and_then(|e| e.as_str()) {
            return Err(error.to_string());
        }
    }

    Ok(body)
}

/// Make an admin API request that captures response headers (for 2FA cookie extraction).
/// Returns (body, headers) tuple.
pub(crate) fn curl_panel_admin_with_headers(
    cfg: &config::AdminApiConfig,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<(String, String), String> {
    let url = format!("{}{}", cfg.panel_url.trim_end_matches('/'), path);
    let auth = admin_curl_auth(cfg)?;

    let mut args = vec!["-s".to_string(), "-D".to_string(), "-".to_string()];
    args.extend(auth.auth_args());
    args.extend([
        "-k".to_string(),
        "-X".to_string(),
        method.to_string(),
    ]);

    // Include 2FA session cookie if available (validated against injection)
    if let Ok(server_id) = config::get_active_server_id() {
        if let Some(cookie) = get_2fa_session(&server_id) {
            if cookie.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'%') {
                args.push("-b".to_string());
                args.push(format!("portlama_2fa_session={}", cookie));
            }
        }
    }

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
        return Err(format!("Request failed: {}", stderr));
    }

    let raw = String::from_utf8_lossy(&output.stdout).to_string();

    // -D - dumps headers followed by body, separated by \r\n\r\n
    let (headers, resp_body) = if let Some(pos) = raw.find("\r\n\r\n") {
        (raw[..pos].to_string(), raw[pos + 4..].to_string())
    } else {
        ("".to_string(), raw)
    };

    if let Ok(err_obj) = serde_json::from_str::<serde_json::Value>(&resp_body) {
        if let Some(error) = err_obj.get("error").and_then(|e| e.as_str()) {
            return Err(error.to_string());
        }
    }

    Ok((resp_body, headers))
}

/// Download a binary file using the admin certificate.
pub(crate) fn curl_panel_admin_binary(
    cfg: &config::AdminApiConfig,
    path: &str,
    output_path: &std::path::Path,
) -> Result<(), String> {
    let url = format!("{}{}", cfg.panel_url.trim_end_matches('/'), path);
    let auth = admin_curl_auth(cfg)?;

    let mut args = vec!["-s".to_string()];
    args.extend(auth.auth_args());
    args.extend([
        "-k".to_string(),
        "-o".to_string(),
        output_path.to_string_lossy().to_string(),
    ]);

    // Include 2FA session cookie if available (validated against injection)
    if let Ok(server_id) = config::get_active_server_id() {
        if let Some(cookie) = get_2fa_session(&server_id) {
            if cookie.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'%') {
                args.push("-b".to_string());
                args.push(format!("portlama_2fa_session={}", cookie));
            }
        }
    }

    args.push(url);

    let output = std::process::Command::new("curl")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run curl: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Download failed: {}", stderr));
    }

    Ok(())
}

/// Upload files via multipart/form-data using the admin certificate.
pub(crate) fn curl_panel_admin_multipart(
    cfg: &config::AdminApiConfig,
    path: &str,
    file_paths: &[String],
    query: Option<&str>,
) -> Result<String, String> {
    let base_url = format!("{}{}", cfg.panel_url.trim_end_matches('/'), path);
    let url = if let Some(q) = query {
        format!("{}?{}", base_url, q)
    } else {
        base_url
    };
    let auth = admin_curl_auth(cfg)?;

    let mut args = vec!["-s".to_string()];
    args.extend(auth.auth_args());
    args.push("-k".to_string());

    // Include 2FA session cookie if available (validated against injection)
    if let Ok(server_id) = config::get_active_server_id() {
        if let Some(cookie) = get_2fa_session(&server_id) {
            if cookie.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'%') {
                args.push("-b".to_string());
                args.push(format!("portlama_2fa_session={}", cookie));
            }
        }
    }

    for file_path in file_paths {
        // Validate file path: must be a regular file, no curl -F special characters
        let p = std::path::Path::new(&file_path);
        if !p.is_file() {
            return Err(format!("Not a regular file: {}", file_path));
        }
        if file_path.contains(';') || file_path.contains('<') || file_path.contains('>') {
            return Err(format!("File path contains invalid characters: {}", file_path));
        }
        args.push("-F".to_string());
        args.push(format!("files=@{}", file_path));
    }

    args.push(url);

    let output = std::process::Command::new("curl")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run curl: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Upload failed: {}", stderr));
    }

    let body = String::from_utf8_lossy(&output.stdout).to_string();

    if let Ok(err_obj) = serde_json::from_str::<serde_json::Value>(&body) {
        if let Some(error) = err_obj.get("error").and_then(|e| e.as_str()) {
            return Err(error.to_string());
        }
    }

    Ok(body)
}
