use crate::config;
use crate::panel_tls;

// ---------------------------------------------------------------------------
// agentd auth token (~/.lamalibre/lamaste/agentd.token)
// ---------------------------------------------------------------------------
//
// The agent panel daemon (port 9393) authenticates loopback callers with a
// shared per-user filesystem token. Only the agent owner can read the file
// (mode 0600), so possession of the token proves we run as that user.
// We cache the value in process memory after the first successful read.

static AGENTD_TOKEN: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// Read `~/.lamalibre/lamaste/agentd.token` and return the bare token string.
/// Returns an error if the file is missing or malformed — callers should
/// surface this so the user knows to (re)start `lamaste-agentd` once, which
/// will create the file.
pub(crate) fn agentd_token() -> Result<&'static str, String> {
    if let Some(cached) = AGENTD_TOKEN.get() {
        return Ok(cached.as_str());
    }
    let path = config::agent_dir().join("agentd.token");
    let raw = std::fs::read_to_string(&path).map_err(|e| {
        format!(
            "Cannot read agentd auth token at {}: {}. Start lamaste-agentd at least once to create it.",
            path.display(),
            e
        )
    })?;
    let parsed: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("Malformed agentd token file ({}): {}", path.display(), e))?;
    let token = parsed
        .get("token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("Missing \"token\" field in {}", path.display()))?;
    if token.is_empty() {
        return Err(format!("Empty token in {}", path.display()));
    }
    // Defensive: reject anything that doesn't look like a hex token to keep
    // garbage out of the Authorization header we'll later format.
    if !token.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("Invalid token format in {}", path.display()));
    }
    let _ = AGENTD_TOKEN.set(token.to_string());
    Ok(AGENTD_TOKEN.get().expect("just set").as_str())
}

/// Run `curl <args>` against the local agentd as its owner. The Bearer token
/// reaches curl on stdin, never in its arguments: other local users can read
/// a process's command line (`/proc/<pid>/cmdline` on Linux), and the token
/// is all that separates them from the daemon's owner — and its plugin
/// install. A request body travels with it, so stdin carries one curl config
/// (`-K -`, see `agentd_stdin_config`). `args` must not make curl read stdin
/// themselves (`@-`, `-`).
pub(crate) fn curl_agentd_as_owner(
    args: &[String],
    body: Option<&str>,
) -> Result<std::process::Output, String> {
    let config = agentd_stdin_config(agentd_token()?, body)?;
    run_curl(args, CurlStdin::Config(config))
}

/// The curl config an agentd call passes on stdin: the Bearer token and,
/// with a body, the body and its JSON content type. `data-raw`, unlike
/// `data-binary`, never reads a file named by a leading `@`. The body must be
/// one line — compact JSON, as `serde_json` writes it.
fn agentd_stdin_config(token: &str, body: Option<&str>) -> Result<String, String> {
    let mut config = curl_config_line("header", &format!("Authorization: Bearer {}", token))?;
    if let Some(body) = body {
        if body.contains(['\r', '\n', '\0']) {
            return Err("A request body for lamaste-agentd must be one line of JSON".to_string());
        }
        config.push_str(&curl_config_line(
            "header",
            "Content-Type: application/json",
        )?);
        config.push_str(&curl_config_line("data-raw", body)?);
    }
    Ok(config)
}

// ---------------------------------------------------------------------------
// Running curl with nothing secret in its arguments
// ---------------------------------------------------------------------------
//
// Other local users can read a process's command line (`ps`,
// `/proc/<pid>/cmdline` on Linux). The client certificate's password and the
// panel's 2FA session cookie therefore live in a private curl config file
// (`-K <file>`, `CurlAuth`), and a request body — a TOTP code, a user's
// password, storage keys — reaches curl on stdin (`run_curl`).

/// One curl config directive, `name = "value"`, with backslashes and double
/// quotes escaped for curl's quoted values. A value holding CR, LF or NUL is
/// refused: curl reads its config line by line, so a line break would start
/// a directive of the value's choosing (and, in a cookie or a header, split
/// the request's headers). The error never repeats the value.
fn curl_config_line(name: &str, value: &str) -> Result<String, String> {
    if value.contains(['\r', '\n', '\0']) {
        return Err(format!(
            "The curl config value of \"{}\" contains a line break or NUL",
            name
        ));
    }
    Ok(format!(
        "{} = \"{}\"\n",
        name,
        value.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}

/// What curl reads on stdin.
pub(crate) enum CurlStdin<'a> {
    /// Nothing: stdin is closed (`/dev/null`).
    Nothing,
    /// A JSON request body (`--data-binary @-`, with its content type).
    JsonBody(&'a str),
    /// A curl config (`-K -`) made of `curl_config_line`s.
    Config(String),
}

impl<'a> CurlStdin<'a> {
    /// The request body as stdin, or nothing.
    pub(crate) fn json(body: Option<&'a str>) -> Self {
        body.map_or(CurlStdin::Nothing, CurlStdin::JsonBody)
    }
}

/// Whether `arg` could make curl read stdin: an option value of `-` (`-K -`,
/// `-T -`, `-b -`) or one starting with `@-` or `<-` (`-d @-`, `-H @-`,
/// `-F name=<-`), in every spelling curl accepts — the value as its own
/// argument, attached to a short option or a cluster of them (`-K-`, `-T-`,
/// `-sK-`, `-d@-`), after a long option's `=` (`--data-binary=@-`,
/// `--config=-`), after a form field's `=` (`files=@-`), or a
/// `--data-urlencode name@-`. A URL is never an option value.
fn reads_stdin(arg: &str) -> bool {
    let reads = |value: &str| value == "-" || value.starts_with("@-") || value.starts_with("<-");
    if arg.starts_with("http://") || arg.starts_with("https://") {
        return false;
    }
    if reads(arg) || arg.ends_with("@-") {
        return true;
    }
    // A short option or a cluster of them, its value attached at any letter.
    if arg.starts_with('-')
        && !arg.starts_with("--")
        && arg.char_indices().skip(2).any(|(i, _)| reads(&arg[i..]))
    {
        return true;
    }
    // `--name=value`, `field=value`: the value after any `=`.
    arg.match_indices('=').any(|(i, _)| reads(&arg[i + 1..]))
}

/// The arguments curl runs with: what makes it read `stdin`, then `args`.
/// `args` must not make curl read stdin themselves (`reads_stdin`), since
/// stdin carries the body or the config.
fn curl_argv(args: &[String], stdin: &CurlStdin) -> Result<Vec<String>, String> {
    if args.iter().any(|a| reads_stdin(a)) {
        return Err(
            "curl arguments must not read stdin: it carries the request body or config".to_string(),
        );
    }
    let mut argv: Vec<String> = match stdin {
        CurlStdin::Nothing => Vec::new(),
        CurlStdin::JsonBody(_) => vec![
            "-H".to_string(),
            "Content-Type: application/json".to_string(),
            "--data-binary".to_string(),
            "@-".to_string(),
        ],
        CurlStdin::Config(_) => vec!["-K".to_string(), "-".to_string()],
    };
    argv.extend(args.iter().cloned());
    Ok(argv)
}

/// Run curl with `args` and `stdin`, and return its output whatever its exit
/// status. curl reads a `@-` body or a `-K -` config in full before it
/// connects, so stdin is written and closed before the output is collected.
pub(crate) fn run_curl(args: &[String], stdin: CurlStdin) -> Result<std::process::Output, String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let argv = curl_argv(args, &stdin)?;
    let input: Option<&[u8]> = match &stdin {
        CurlStdin::Nothing => None,
        CurlStdin::JsonBody(body) => Some(body.as_bytes()),
        CurlStdin::Config(config) => Some(config.as_bytes()),
    };
    let mut child = Command::new("curl")
        .args(&argv)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run curl: {}", e))?;
    // The pipe is dropped at the end of the match arm, which closes stdin.
    let written = match (input, child.stdin.take()) {
        (Some(bytes), Some(mut pipe)) => pipe.write_all(bytes),
        _ => Ok(()),
    };
    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to run curl: {}", e))?;
    if let Err(e) = written {
        // curl stopped before reading its stdin; its own error says why.
        return Err(format!(
            "Failed to pass the request to curl: {}: {}",
            e,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(output)
}

/// RAII guard for a private curl config file (`-K <path>`), deleted on drop
/// so it is cleaned up on error paths too.
pub(crate) struct CurlConfigFile {
    path: std::path::PathBuf,
}

impl CurlConfigFile {
    /// Create the file in the agent directory, which only its owner can
    /// write.
    fn create(content: &str) -> Result<Self, String> {
        let dir = config::agent_dir();
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create agent directory: {}", e))?;
        Self::create_in(&dir, content)
    }

    /// Create the file in `dir` exclusively (`O_EXCL`, so an existing file or
    /// link at the path is never written through) with mode 0600 from the
    /// start, so its content is never readable by anyone else.
    fn create_in(dir: &std::path::Path, content: &str) -> Result<Self, String> {
        use std::io::Write;

        let path = dir.join(format!(
            ".curl-config-{}.tmp",
            uuid::Uuid::new_v4().simple()
        ));

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

        // From here on the guard owns the file: a failed write removes it.
        let guard = Self { path };
        file.write_all(content.as_bytes())
            .map_err(|e| format!("Failed to write curl config file: {}", e))?;
        Ok(guard)
    }
}

impl Drop for CurlConfigFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

// --- Shared curl helpers ---

/// The client certificate a panel request authenticates with.
enum ClientCert<'a> {
    P12 { path: &'a str, password: &'a str },
    Keychain(&'a str),
}

/// The private curl config of a panel request: the client certificate (a
/// P12 and its password, or a Keychain identity) and, when given, the 2FA
/// session cookie.
fn curl_auth_config(cert: &ClientCert, session_cookie: Option<&str>) -> Result<String, String> {
    let mut content = match cert {
        ClientCert::P12 { path, password } => {
            if path.contains(['\r', '\n', '\0']) {
                return Err("P12 path contains invalid characters".to_string());
            }
            if password.contains(['\r', '\n', '\0']) {
                return Err("P12 password contains invalid characters".to_string());
            }
            curl_config_line("cert", &format!("{}:{}", path, password))?
                + &curl_config_line("cert-type", "P12")?
        }
        ClientCert::Keychain(identity) => curl_config_line("cert", identity)?,
    };
    if let Some(cookie) = session_cookie {
        content.push_str(&curl_config_line(
            "cookie",
            &format!("lamaste_2fa_session={}", cookie),
        )?);
    }
    Ok(content)
}

/// How a panel request authenticates, in a private curl config file passed
/// with `-K` (see `curl_auth_config`). Keep it alive until curl has finished:
/// dropping it deletes the file.
pub(crate) struct CurlAuth {
    file: CurlConfigFile,
}

impl CurlAuth {
    fn create(cert: &ClientCert, session_cookie: Option<&str>) -> Result<Self, String> {
        Ok(Self {
            file: CurlConfigFile::create(&curl_auth_config(cert, session_cookie)?)?,
        })
    }

    /// An agent's client certificate.
    fn new(cfg: &config::AgentConfig) -> Result<Self, String> {
        let cert = if cfg.auth_method == "keychain" {
            ClientCert::Keychain(
                cfg.keychain_identity
                    .as_deref()
                    .ok_or("Keychain identity not configured")?,
            )
        } else {
            ClientCert::P12 {
                path: cfg.p12_path.as_deref().ok_or("P12 path not configured")?,
                password: cfg
                    .p12_password
                    .as_deref()
                    .ok_or("P12 password not configured")?,
            }
        };
        Self::create(&cert, None)
    }

    pub(crate) fn auth_args(&self) -> Vec<String> {
        vec![
            "-K".to_string(),
            self.file.path.to_string_lossy().to_string(),
        ]
    }
}

/// Build a CurlAuth for a server's admin config (for use in health checks etc.).
/// The returned CurlAuth must be kept alive until the curl command completes
/// (it holds the RAII guard for the temp config file).
pub(crate) fn build_curl_auth_for_server(cfg: &config::AdminApiConfig) -> Result<CurlAuth, String> {
    CurlAuth::create(&admin_client_cert(cfg)?, None)
}

/// curl's TLS arguments for a call to the panel of an admin config: none
/// for a domain (its CA verifies it), the pinned key for an IP panel — read
/// from the panel and stored with the server on first use when the server
/// has none yet (see `panel_tls`).
pub(crate) fn admin_tls_args(cfg: &config::AdminApiConfig) -> Result<Vec<String>, String> {
    if !panel_tls::needs_pin(&cfg.panel_url)? {
        return Ok(Vec::new());
    }
    let pin = match (&cfg.panel_pin, &cfg.server_id) {
        (Some(pin), _) => pin.clone(),
        (None, Some(server_id)) => crate::cloud::server_panel_pin(server_id)?,
        (None, None) => return panel_tls::tls_args(&cfg.panel_url, None),
    };
    panel_tls::tls_args(&cfg.panel_url, Some(&pin))
}

/// curl's TLS arguments for an agent's call to its panel: the key the agent
/// pinned when it enrolled (`lamaste-agent setup`, `panel reset-pin`). The
/// app never pins for an agent; it uses the agent's own pin.
fn agent_tls_args(cfg: &config::AgentConfig) -> Result<Vec<String>, String> {
    panel_tls::tls_args(&cfg.panel_url, cfg.panel_server_pubkey_sha256.as_deref()).map_err(|e| {
        if cfg.panel_server_pubkey_sha256.is_none() {
            format!(
                "{}. Run `lamaste-agent panel reset-pin` for this agent (with its --label) to pin it.",
                e
            )
        } else {
            e
        }
    })
}

pub(crate) fn curl_panel(
    cfg: &config::AgentConfig,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<String, String> {
    let url = format!("{}{}", cfg.panel_url.trim_end_matches('/'), path);
    let tls = agent_tls_args(cfg)?;
    let auth = CurlAuth::new(cfg)?;

    let mut args = vec!["-s".to_string()];
    args.extend(auth.auth_args());
    args.extend(tls);
    args.extend(["-X".to_string(), method.to_string(), url]);

    let output = run_curl(&args, CurlStdin::json(body))?;

    // auth is dropped here (or on early return), deleting its config file

    if !output.status.success() {
        return Err(panel_tls::curl_error("Request failed", &cfg.panel_url, &output));
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
/// The agent panel server binds 127.0.0.1 only and authenticates loopback
/// callers via a Bearer token stored at `~/.lamalibre/lamaste/agentd.token`. The token
/// is mode 0600, so only the agent's owning OS user can read it, and it is
/// handed to curl on stdin with the body (`curl_agentd_as_owner`). Headers
/// claiming a caller (`X-SSL-Client-*`, `Remote-User`) prove nothing to the
/// daemon.
///
/// `agent_label` is unused at the wire level (the daemon attributes the call
/// to its own `--label` once the token matches), but kept in the signature
/// for call-site clarity and future per-agent routing.
pub(crate) fn curl_agent_local_panel(
    _agent_label: &str,
    port: u16,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<String, String> {
    let url = format!("http://127.0.0.1:{}{}", port, path);

    let args = vec!["-s".to_string(), "-X".to_string(), method.to_string(), url];

    let output = curl_agentd_as_owner(&args, body)?;

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

/// The 2FA session cookie stored for the active server, if it is made only
/// of the characters the panel's signed cookie uses; anything else is left
/// out (the panel then asks for the code again) rather than sent into the
/// request's `Cookie` header.
fn active_2fa_session() -> Option<String> {
    let server_id = config::get_active_server_id().ok()?;
    let cookie = get_2fa_session(&server_id)?;
    cookie
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'%')
        .then_some(cookie)
}

/// The client certificate of an AdminApiConfig.
fn admin_client_cert(cfg: &config::AdminApiConfig) -> Result<ClientCert<'_>, String> {
    if cfg.auth_method == "keychain" {
        let identity = cfg
            .keychain_identity
            .as_deref()
            .ok_or("Admin keychain identity not configured")?;
        Ok(ClientCert::Keychain(identity))
    } else {
        let path = cfg
            .p12_path
            .as_deref()
            .ok_or("Admin P12 path not configured")?;
        let password = cfg
            .p12_password
            .as_deref()
            .ok_or("Admin P12 password not configured")?;
        Ok(ClientCert::P12 { path, password })
    }
}

/// Build a CurlAuth from an AdminApiConfig, with the 2FA session cookie
/// when one is stored for the active server.
fn admin_curl_auth(cfg: &config::AdminApiConfig) -> Result<CurlAuth, String> {
    CurlAuth::create(&admin_client_cert(cfg)?, active_2fa_session().as_deref())
}

/// The panel's error message in a response body (`{ "error": ... }`),
/// followed by what a failed validation found (`details.issues`, as
/// `field: message; ...`) — "Validation failed" alone tells the
/// administrator nothing about what to correct. None when the body is not
/// an error.
pub(crate) fn panel_error_text(body: &serde_json::Value) -> Option<String> {
    let error = body.get("error")?.as_str()?;
    let mut found: Vec<String> = Vec::new();
    let issues = body
        .get("details")
        .and_then(|d| d.get("issues"))
        .and_then(|i| i.as_array());
    for issue in issues.into_iter().flatten() {
        let Some(message) = issue.get("message").and_then(|m| m.as_str()) else {
            continue;
        };
        let path: Vec<String> = issue
            .get("path")
            .and_then(|p| p.as_array())
            .map(|segments| {
                segments
                    .iter()
                    .map(|s| s.as_str().map(str::to_string).unwrap_or_else(|| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        let line = if path.is_empty() {
            message.to_string()
        } else {
            format!("{}: {}", path.join("."), message)
        };
        if !found.contains(&line) {
            found.push(line);
        }
    }
    Some(if found.is_empty() {
        error.to_string()
    } else {
        format!("{}: {}", error, found.join("; "))
    })
}

/// Make an admin API request to the panel.
/// Includes the 2FA session cookie if one is stored for the active server.
pub(crate) fn curl_panel_admin(
    cfg: &config::AdminApiConfig,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<String, String> {
    let body = curl_panel_admin_response(cfg, method, path, body)?;

    if let Ok(err_obj) = serde_json::from_str::<serde_json::Value>(&body) {
        if let Some(error) = panel_error_text(&err_obj) {
            return Err(error);
        }
    }

    Ok(body)
}

/// Make an admin API request to the panel and return its body as it came,
/// a refusal (`{ "error": ... }` with whatever else the panel said) included:
/// only a request that did not complete is an error. For callers that need
/// more of a refusal than its message.
/// Includes the 2FA session cookie if one is stored for the active server.
pub(crate) fn curl_panel_admin_response(
    cfg: &config::AdminApiConfig,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<String, String> {
    run_admin_curl(cfg, method, path, body, &[])
}

/// The `--write-out` that puts the HTTP status on a line of its own after
/// the body, for `split_status`.
const WRITE_OUT_STATUS: &str = "\n%{http_code}";

/// Split curl's output written with `-w WRITE_OUT_STATUS` into the body and
/// the HTTP status — 0 when curl reported none it could parse.
pub(crate) fn split_status(stdout: &str) -> (&str, u16) {
    let (body, status) = stdout.rsplit_once('\n').unwrap_or(("", stdout));
    (body, status.trim().parse().unwrap_or(0))
}

/// Make an admin API request to the panel and return its HTTP status with
/// the body as it came, a refusal included: only a request that did not
/// complete is an error. For callers that answer a refusal by its status
/// and the fields the panel sent with it (`code`, `errors`, ...).
/// Includes the 2FA session cookie if one is stored for the active server.
pub(crate) fn curl_panel_admin_status(
    cfg: &config::AdminApiConfig,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<(u16, String), String> {
    let stdout = run_admin_curl(cfg, method, path, body, &["-w", WRITE_OUT_STATUS])?;
    let (payload, status) = split_status(&stdout);
    Ok((status, payload.to_string()))
}

/// One admin request with curl: the client certificate and the 2FA session
/// cookie in a private config file, the body on stdin, `extra` arguments
/// before the URL. Returns curl's output; an error only when curl failed.
fn run_admin_curl(
    cfg: &config::AdminApiConfig,
    method: &str,
    path: &str,
    body: Option<&str>,
    extra: &[&str],
) -> Result<String, String> {
    let url = format!("{}{}", cfg.panel_url.trim_end_matches('/'), path);
    // The panel verified first: nothing is sent to anything else.
    let tls = admin_tls_args(cfg)?;
    // The client certificate and the 2FA session cookie, in its config file.
    let auth = admin_curl_auth(cfg)?;

    let mut args = vec!["-s".to_string()];
    args.extend(auth.auth_args());
    args.extend(tls);
    args.extend(["-X".to_string(), method.to_string()]);
    args.extend(extra.iter().map(|a| a.to_string()));
    args.push(url);

    let output = run_curl(&args, CurlStdin::json(body))?;

    if !output.status.success() {
        return Err(panel_tls::curl_error("Request failed", &cfg.panel_url, &output));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
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
    // The panel verified first: a TOTP code or password goes nowhere else.
    let tls = admin_tls_args(cfg)?;
    // The client certificate and the 2FA session cookie, in its config file.
    let auth = admin_curl_auth(cfg)?;

    // `-i` puts the response headers before the body on stdout (`-D -`
    // would too, but a `-` argument is refused: stdin carries the body).
    let mut args = vec!["-s".to_string(), "-i".to_string()];
    args.extend(auth.auth_args());
    args.extend(tls);
    args.extend(["-X".to_string(), method.to_string(), url]);

    let output = run_curl(&args, CurlStdin::json(body))?;

    if !output.status.success() {
        return Err(panel_tls::curl_error("Request failed", &cfg.panel_url, &output));
    }

    let raw = String::from_utf8_lossy(&output.stdout).to_string();

    // -i writes the headers followed by the body, separated by \r\n\r\n
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
    let tls = admin_tls_args(cfg)?;
    // The client certificate and the 2FA session cookie, in its config file.
    let auth = admin_curl_auth(cfg)?;

    let mut args = vec!["-s".to_string()];
    args.extend(auth.auth_args());
    args.extend(tls);
    args.extend([
        "-o".to_string(),
        output_path.to_string_lossy().to_string(),
        url,
    ]);

    let output = run_curl(&args, CurlStdin::Nothing)?;

    if !output.status.success() {
        return Err(panel_tls::curl_error("Download failed", &cfg.panel_url, &output));
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
    let tls = admin_tls_args(cfg)?;
    // The client certificate and the 2FA session cookie, in its config file.
    let auth = admin_curl_auth(cfg)?;

    let mut args = vec!["-s".to_string()];
    args.extend(auth.auth_args());
    args.extend(tls);

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

    let output = run_curl(&args, CurlStdin::Nothing)?;

    if !output.status.success() {
        return Err(panel_tls::curl_error("Upload failed", &cfg.panel_url, &output));
    }

    let body = String::from_utf8_lossy(&output.stdout).to_string();

    if let Ok(err_obj) = serde_json::from_str::<serde_json::Value>(&body) {
        if let Some(error) = err_obj.get("error").and_then(|e| e.as_str()) {
            return Err(error.to_string());
        }
    }

    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};

    const SECRET: &str = "s3cr3t-\"quoted\"-\\-SECRET";

    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|a| a.to_string()).collect()
    }

    #[test]
    fn config_line_quotes_and_escapes() {
        assert_eq!(
            curl_config_line("cookie", "a=b").unwrap(),
            "cookie = \"a=b\"\n"
        );
        assert_eq!(
            curl_config_line("cert", "C:\\p12:pa\"ss").unwrap(),
            "cert = \"C:\\\\p12:pa\\\"ss\"\n"
        );
    }

    #[test]
    fn config_line_refuses_line_breaks_and_nul_without_repeating_them() {
        for bad in ["v\nheader = \"X-Injected: 1\"", "v\rw", "v\0w"] {
            let err = curl_config_line("cookie", bad).unwrap_err();
            assert!(
                err.contains("\"cookie\" contains a line break or NUL"),
                "{}",
                err
            );
            assert!(!err.contains(bad));
        }
    }

    #[test]
    fn a_json_body_goes_to_stdin_never_into_the_arguments() {
        let body = format!("{{\"code\":\"{}\"}}", SECRET);
        let args = strings(&["-s", "-X", "POST", "https://panel.example/api/x"]);
        let argv = curl_argv(&args, &CurlStdin::JsonBody(&body)).unwrap();
        assert_eq!(
            argv,
            strings(&[
                "-H",
                "Content-Type: application/json",
                "--data-binary",
                "@-",
                "-s",
                "-X",
                "POST",
                "https://panel.example/api/x",
            ])
        );
        assert!(!argv.iter().any(|a| a.contains("SECRET")));
    }

    #[test]
    fn a_config_goes_to_stdin_and_nothing_adds_no_argument() {
        let args = strings(&["-s", "http://127.0.0.1:9393/api/status"]);
        let config =
            curl_config_line("header", &format!("Authorization: Bearer {}", SECRET)).unwrap();
        let argv = curl_argv(&args, &CurlStdin::Config(config)).unwrap();
        assert_eq!(
            argv,
            strings(&["-K", "-", "-s", "http://127.0.0.1:9393/api/status"])
        );
        assert_eq!(curl_argv(&args, &CurlStdin::Nothing).unwrap(), args);
        assert!(matches!(CurlStdin::json(None), CurlStdin::Nothing));
        assert!(matches!(
            CurlStdin::json(Some("{}")),
            CurlStdin::JsonBody("{}")
        ));
    }

    #[test]
    fn arguments_that_read_stdin_are_refused() {
        for bad in [
            "-", "@-", "@-x", "<-", "-d@-", "files=@-", "name=<-", "name@-",
            // A value attached to a short option or a cluster of them.
            "-K-", "-T-", "-b-", "-sK-", "-sd@-", "-H@-",
            // After a long option's `=`.
            "--data-binary=@-", "--config=-", "--upload-file=-", "--json=@-",
            "files=@-;type=text/plain",
        ] {
            let args = strings(&["-s", bad, "http://127.0.0.1/"]);
            assert!(curl_argv(&args, &CurlStdin::Nothing).is_err(), "{}", bad);
            let args = strings(&["-s", "-H", bad, "http://127.0.0.1/"]);
            assert!(curl_argv(&args, &CurlStdin::Nothing).is_err(), "{}", bad);
        }
        // What the app does pass stays allowed.
        let fine = strings(&[
            "-s", "-sS", "-i", "-k", "--max-time", "10", "-X", "POST", "-o", "/tmp/out.bin",
            "--pinnedpubkey", "sha256//47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
            "-H", "Accept: application/json", "-w", "\n%{http_code}",
            "-F", "files=@/Users/me/site/index.html",
            "https://203.0.113.7:9292/api/x?offset=-1&q=@-",
        ]);
        assert!(curl_argv(&fine, &CurlStdin::Nothing).is_ok());
    }

    fn agent_config(panel_url: &str, pin: Option<&str>) -> config::AgentConfig {
        serde_json::from_value(serde_json::json!({
            "panelUrl": panel_url,
            "authMethod": "p12",
            "panelServerPubkeySha256": pin,
        }))
        .unwrap()
    }

    #[test]
    fn an_agent_call_uses_the_agents_pin_and_never_goes_unverified() {
        let pin = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
        assert_eq!(
            agent_tls_args(&agent_config("https://203.0.113.42:9292", Some(pin))).unwrap(),
            strings(&["-k", "--pinnedpubkey", &format!("sha256//{}", pin)])
        );
        assert!(agent_tls_args(&agent_config("https://panel.example.com", None))
            .unwrap()
            .is_empty());
        let err = agent_tls_args(&agent_config("https://203.0.113.42:9292", None)).unwrap_err();
        assert!(err.contains("No TLS key is pinned"), "{}", err);
        assert!(err.contains("lamaste-agent panel reset-pin"), "{}", err);
    }

    #[test]
    fn an_admin_call_uses_the_servers_pin() {
        let pin = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
        let cfg = |url: &str, pin: Option<&str>| config::AdminApiConfig {
            panel_url: url.to_string(),
            auth_method: "p12".to_string(),
            p12_path: None,
            p12_password: None,
            keychain_identity: None,
            server_id: None,
            panel_pin: pin.map(String::from),
        };
        assert_eq!(
            admin_tls_args(&cfg("https://203.0.113.42:9292", Some(pin))).unwrap(),
            strings(&["-k", "--pinnedpubkey", &format!("sha256//{}", pin)])
        );
        assert!(admin_tls_args(&cfg("https://panel.example.com", None)).unwrap().is_empty());
        // Without a pin and without a server to store one with: refused.
        assert!(admin_tls_args(&cfg("https://203.0.113.42:9292", None)).is_err());
    }

    #[test]
    fn the_agentd_config_carries_the_token_and_the_body() {
        assert_eq!(
            agentd_stdin_config("abc123", None).unwrap(),
            "header = \"Authorization: Bearer abc123\"\n"
        );
        assert_eq!(
            agentd_stdin_config("abc123", Some("{\"description\":\"a \\\"b\\\" \\\\ c\"}"))
                .unwrap(),
            "header = \"Authorization: Bearer abc123\"\n\
             header = \"Content-Type: application/json\"\n\
             data-raw = \"{\\\"description\\\":\\\"a \\\\\\\"b\\\\\\\" \\\\\\\\ c\\\"}\"\n"
        );
        let err = agentd_stdin_config("abc123", Some("{\n  \"a\": 1\n}")).unwrap_err();
        assert!(err.contains("one line of JSON"), "{}", err);
    }

    #[test]
    fn the_auth_config_holds_the_certificate_and_the_session_cookie() {
        let p12 = ClientCert::P12 {
            path: "/home/u/client.p12",
            password: "pa\"ss\\word",
        };
        assert_eq!(
            curl_auth_config(&p12, None).unwrap(),
            "cert = \"/home/u/client.p12:pa\\\"ss\\\\word\"\ncert-type = \"P12\"\n"
        );
        assert_eq!(
            curl_auth_config(
                &ClientCert::Keychain("Lamaste Admin (mac)"),
                Some("v1.sig%2F")
            )
            .unwrap(),
            "cert = \"Lamaste Admin (mac)\"\ncookie = \"lamaste_2fa_session=v1.sig%2F\"\n"
        );
        let bad_password = ClientCert::P12 {
            path: "/p.p12",
            password: "pw\ncookie = \"x\"",
        };
        assert_eq!(
            curl_auth_config(&bad_password, None).unwrap_err(),
            "P12 password contains invalid characters"
        );
        let bad_path = ClientCert::P12 {
            path: "/p\r.p12",
            password: "pw",
        };
        assert_eq!(
            curl_auth_config(&bad_path, None).unwrap_err(),
            "P12 path contains invalid characters"
        );
        assert!(
            curl_auth_config(&ClientCert::Keychain("id"), Some("v\nheader = \"X: 1\"")).is_err()
        );
    }

    /// A fresh directory under the system temporary directory.
    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "lamaste-desktop-{}-{}",
            name,
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir(&dir).unwrap();
        dir
    }

    #[cfg(unix)]
    #[test]
    fn the_config_file_is_0600_and_removed_on_drop() {
        use std::os::unix::fs::PermissionsExt;

        let dir = temp_dir("curl-config");
        let file = CurlConfigFile::create_in(&dir, "cookie = \"a=b\"\n").unwrap();
        let path = file.path.clone();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "cookie = \"a=b\"\n"
        );
        drop(file);
        assert!(!path.exists());
        std::fs::remove_dir(&dir).unwrap();
    }

    /// A loopback HTTP server answering one request; the handle yields the
    /// request's head and body.
    fn one_request_server() -> (String, std::thread::JoinHandle<(String, String)>) {
        let (base, handle) = one_request_server_answering(
            "HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}",
        );
        (format!("{}/api/test", base), handle)
    }

    /// A loopback HTTP server answering one request with `response`; returns
    /// its base URL, and the handle yields the request's head and body.
    fn one_request_server_answering(
        response: &'static str,
    ) -> (String, std::thread::JoinHandle<(String, String)>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                head.push_str(&line);
            }
            let length = head
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    if name.eq_ignore_ascii_case("content-length") {
                        value.trim().parse::<usize>().ok()
                    } else {
                        None
                    }
                })
                .unwrap_or(0);
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            stream.write_all(response.as_bytes()).unwrap();
            (head, String::from_utf8(body).unwrap())
        });
        (base, handle)
    }

    #[test]
    fn run_curl_sends_a_json_body_from_stdin() {
        let (url, server) = one_request_server();
        let body = format!("{{\"code\":\"{}\",\"note\":\"é\"}}", SECRET);
        let args = strings(&["-s", "--max-time", "10", "-X", "POST", &url]);
        let output = run_curl(&args, CurlStdin::JsonBody(&body)).unwrap();
        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout), "{\"ok\":true}");
        let (head, received) = server.join().unwrap();
        assert!(head.starts_with("POST /api/test "), "{}", head);
        assert!(
            head.contains("Content-Type: application/json\r\n"),
            "{}",
            head
        );
        assert_eq!(received, body);
    }

    #[test]
    fn run_curl_reads_a_config_from_stdin() {
        let (url, server) = one_request_server();
        let body = "{\"description\":\"a \\\"b\\\" \\\\ c\",\"port\":3000}";
        let config = agentd_stdin_config("abc123", Some(body)).unwrap();
        let args = strings(&["-s", "--max-time", "10", "-X", "POST", &url]);
        let output = run_curl(&args, CurlStdin::Config(config)).unwrap();
        assert!(output.status.success());
        let (head, received) = server.join().unwrap();
        assert!(
            head.contains("Authorization: Bearer abc123\r\n"),
            "{}",
            head
        );
        assert!(
            head.contains("Content-Type: application/json\r\n"),
            "{}",
            head
        );
        assert_eq!(received, body);
    }

    #[test]
    fn the_session_cookie_reaches_the_panel_from_the_config_file() {
        let (url, server) = one_request_server();
        let dir = temp_dir("curl-cookie");
        // curl presents a client certificate only over TLS; the cookie is
        // what this plain-HTTP request checks.
        let config = curl_auth_config(&ClientCert::Keychain("unused"), Some("v1.sig%2F")).unwrap();
        let file = CurlConfigFile::create_in(&dir, &config).unwrap();
        let mut args = strings(&["-s", "--max-time", "10"]);
        args.extend([
            "-K".to_string(),
            file.path.to_string_lossy().to_string(),
            url,
        ]);
        let output = run_curl(&args, CurlStdin::Nothing).unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let (head, received) = server.join().unwrap();
        assert!(head.starts_with("GET /api/test "), "{}", head);
        assert!(
            head.contains("Cookie: lamaste_2fa_session=v1.sig%2F\r\n"),
            "{}",
            head
        );
        assert_eq!(received, "");
        drop(file);
        std::fs::remove_dir(&dir).unwrap();
    }

    #[test]
    fn the_status_is_split_from_the_body() {
        assert_eq!(split_status("{\"a\":1}\n409"), ("{\"a\":1}", 409));
        assert_eq!(split_status("line one\nline two\n200"), ("line one\nline two", 200));
        assert_eq!(split_status("\n204"), ("", 204));
        // No status curl could report.
        assert_eq!(split_status("\n000"), ("", 0));
        assert_eq!(split_status(""), ("", 0));
    }

    #[test]
    fn an_admin_request_answers_the_status_with_the_refusal_and_sends_the_body_on_stdin() {
        use crate::panel_tls::tests::{openssl_pin, self_signed, temp_dir, tls_one_request_server};
        let dir = temp_dir();
        let (cert, key) = self_signed(&dir, "panel");
        let (base, server) = tls_one_request_server(
            &cert,
            &key,
            "HTTP/1.1 422 Unprocessable Entity\r\nContent-Type: application/json\r\nContent-Length: 49\r\nConnection: close\r\n\r\n{\"error\":\"Invalid settings\",\"errors\":{\"a\":\"Bad\"}}",
        );
        // The admin's P12 (3DES/SHA-1, which every curl build reads), and
        // the panel verified by its pinned key.
        let (client_cert, client_key) = self_signed(&dir, "client");
        let p12 = dir.join("client.p12");
        let made = std::process::Command::new("openssl")
            .args(["pkcs12", "-export", "-inkey"])
            .arg(&client_key)
            .arg("-in")
            .arg(&client_cert)
            .arg("-out")
            .arg(&p12)
            .args(["-passout", "pass:p12-test", "-certpbe", "PBE-SHA1-3DES"])
            .args(["-keypbe", "PBE-SHA1-3DES", "-macalg", "sha1"])
            .output()
            .expect("openssl runs");
        assert!(made.status.success(), "{}", String::from_utf8_lossy(&made.stderr));
        let cfg = config::AdminApiConfig {
            panel_url: base,
            auth_method: "p12".to_string(),
            p12_path: Some(p12.to_string_lossy().to_string()),
            p12_password: Some("p12-test".to_string()),
            keychain_identity: None,
            server_id: None,
            panel_pin: Some(openssl_pin(&cert)),
        };
        let body = serde_json::json!({ "revision": 1, "secrets": { "apiKey": SECRET } }).to_string();
        let (status, answer) =
            curl_panel_admin_status(&cfg, "PUT", "/api/plugins/fx/settings", Some(&body)).unwrap();
        assert_eq!(status, 422);
        assert_eq!(answer, "{\"error\":\"Invalid settings\",\"errors\":{\"a\":\"Bad\"}}");
        let (head, received) = server.join().unwrap();
        assert!(head.starts_with("PUT /api/plugins/fx/settings "), "{}", head);
        assert!(head.contains("Content-Type: application/json\r\n"), "{}", head);
        assert_eq!(received, body);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
