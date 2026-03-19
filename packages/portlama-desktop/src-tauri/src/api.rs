use crate::config;

// --- Curl config file helper (keeps P12 password out of process args) ---

/// RAII guard that creates a temporary curl config file with cert credentials
/// and deletes it on drop, ensuring cleanup even on error paths.
struct CurlConfigFile {
    path: std::path::PathBuf,
}

impl CurlConfigFile {
    fn new(cfg: &config::AgentConfig) -> Result<Self, String> {
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
        if cfg.p12_password.contains('\n')
            || cfg.p12_password.contains('\r')
            || cfg.p12_password.contains('\0')
        {
            return Err("P12 password contains invalid characters".to_string());
        }
        if cfg.p12_path.contains('\n')
            || cfg.p12_path.contains('\r')
            || cfg.p12_path.contains('\0')
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
            cfg.p12_path.replace('\\', "\\\\").replace('"', "\\\""),
            cfg.p12_password.replace('\\', "\\\\").replace('"', "\\\""),
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

pub(crate) fn curl_panel(
    cfg: &config::AgentConfig,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<String, String> {
    let url = format!("{}{}", cfg.panel_url.trim_end_matches('/'), path);
    let curl_cfg = CurlConfigFile::new(cfg)?;

    let mut args = vec![
        "-s".to_string(),
        "-K".to_string(),
        curl_cfg.path.to_string_lossy().to_string(),
        "-k".to_string(),
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

    // curl_cfg is dropped here (or on early return), cleaning up the temp file

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

pub(crate) fn curl_panel_binary(
    cfg: &config::AgentConfig,
    path: &str,
    output_path: &std::path::Path,
) -> Result<(), String> {
    let url = format!("{}{}", cfg.panel_url.trim_end_matches('/'), path);
    let curl_cfg = CurlConfigFile::new(cfg)?;

    let output = std::process::Command::new("curl")
        .args([
            "-s",
            "-K", &curl_cfg.path.to_string_lossy(),
            "-k",
            "-o", &output_path.to_string_lossy(),
            &url,
        ])
        .output()
        .map_err(|e| format!("Failed to run curl: {}", e))?;

    // curl_cfg is dropped here, cleaning up the temp file

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Download failed: {}", stderr));
    }

    Ok(())
}
