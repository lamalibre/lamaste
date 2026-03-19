use crate::api::curl_panel;
use crate::config;
use serde::{Deserialize, Serialize};
use std::net::TcpStream;
use std::sync::Mutex;
use std::time::Duration;

// Mutex to serialize registry read-modify-write operations, preventing
// concurrent add/remove from racing and silently discarding changes.
static REGISTRY_LOCK: Mutex<()> = Mutex::new(());

const MAX_CUSTOM_SERVICES: usize = 100;
const MAX_NAME_LEN: usize = 64;
const MAX_DESCRIPTION_LEN: usize = 256;
const VALID_CATEGORIES: &[&str] = &["ai", "database", "dev", "media", "monitoring", "custom"];

// --- Structs ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectConfig {
    pub binary: Option<String>,
    pub process_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceDefinition {
    pub id: String,
    pub name: String,
    pub default_port: u16,
    pub category: String,
    pub description: String,
    pub detect: DetectConfig,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceRegistry {
    pub services: Vec<ServiceDefinition>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedService {
    pub id: String,
    pub name: String,
    pub category: String,
    pub description: String,
    pub default_port: u16,
    pub detected_port: Option<u16>,
    pub status: String,
    pub source: String,
    pub tunnel_id: Option<String>,
    pub tunnel_fqdn: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    pub ports: Vec<DockerPort>,
    pub status: String,
    pub tunnel_id: Option<String>,
    pub tunnel_fqdn: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerPort {
    pub host_port: u16,
    pub container_port: u16,
    pub protocol: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub services: Vec<DetectedService>,
    pub docker_containers: Vec<DockerContainer>,
}

// --- Tunnel info for matching ---

#[derive(Debug, Deserialize)]
struct TunnelInfo {
    id: Option<String>,
    port: Option<u32>,
    fqdn: Option<String>,
}

#[derive(Deserialize)]
struct TunnelsResponse {
    tunnels: Vec<TunnelInfo>,
}

// --- Input validation ---

fn validate_binary_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > MAX_NAME_LEN {
        return Err(format!("Binary name must be 1-{} characters", MAX_NAME_LEN));
    }
    if !name.chars().all(|c| c.is_alphanumeric() || c == '.' || c == '_' || c == '-') {
        return Err("Binary name may only contain alphanumeric characters, dots, underscores, and hyphens".to_string());
    }
    Ok(())
}

fn validate_process_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 128 {
        return Err("Process name must be 1-128 characters".to_string());
    }
    // Custom process names are restricted to a safe charset: alphanumeric,
    // dots, underscores, hyphens, and spaces. This avoids regex injection
    // risks since pgrep -f interprets the pattern as extended regex.
    // Builtin entries (like "python.*comfyui") use regex but are hardcoded.
    if !name.chars().all(|c| c.is_alphanumeric() || c == '.' || c == '_' || c == '-' || c == ' ') {
        return Err("Process name may only contain alphanumeric characters, dots, underscores, hyphens, and spaces".to_string());
    }
    Ok(())
}

fn sanitize_id(name: &str) -> Result<String, String> {
    let raw: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();

    // Collapse consecutive hyphens and trim from both ends
    let mut id = String::new();
    let mut last_was_hyphen = true; // treat start as hyphen to trim leading
    for c in raw.chars() {
        if c == '-' {
            if !last_was_hyphen {
                id.push('-');
            }
            last_was_hyphen = true;
        } else {
            id.push(c);
            last_was_hyphen = false;
        }
    }
    // Trim trailing hyphen
    while id.ends_with('-') {
        id.pop();
    }

    if id.is_empty() {
        return Err("Name must contain at least one alphanumeric character".to_string());
    }

    Ok(id)
}

// --- Default registry ---

fn default_registry() -> ServiceRegistry {
    ServiceRegistry {
        services: vec![
            ServiceDefinition {
                id: "ollama".into(),
                name: "Ollama".into(),
                default_port: 11434,
                category: "ai".into(),
                description: "Local large language model server".into(),
                detect: DetectConfig {
                    binary: Some("ollama".into()),
                    process_name: Some("ollama".into()),
                },
                custom: None,
            },
            ServiceDefinition {
                id: "comfyui".into(),
                name: "ComfyUI".into(),
                default_port: 8188,
                category: "ai".into(),
                description: "Node-based Stable Diffusion GUI".into(),
                detect: DetectConfig {
                    binary: None,
                    process_name: Some("python.*comfyui".into()),
                },
                custom: None,
            },
            ServiceDefinition {
                id: "lm-studio".into(),
                name: "LM Studio".into(),
                default_port: 1234,
                category: "ai".into(),
                description: "Desktop app for running local LLMs".into(),
                detect: DetectConfig {
                    binary: None,
                    process_name: Some("LM Studio".into()),
                },
                custom: None,
            },
            ServiceDefinition {
                id: "sd-webui".into(),
                name: "Stable Diffusion WebUI".into(),
                default_port: 7860,
                category: "ai".into(),
                description: "AUTOMATIC1111 Stable Diffusion web interface".into(),
                detect: DetectConfig {
                    binary: None,
                    process_name: Some("webui.py".into()),
                },
                custom: None,
            },
            ServiceDefinition {
                id: "open-webui".into(),
                name: "Open WebUI".into(),
                default_port: 3000,
                category: "ai".into(),
                description: "Web interface for local LLMs".into(),
                detect: DetectConfig {
                    binary: Some("open-webui".into()),
                    process_name: Some("open-webui".into()),
                },
                custom: None,
            },
            ServiceDefinition {
                id: "localai".into(),
                name: "LocalAI".into(),
                default_port: 8080,
                category: "ai".into(),
                description: "Self-hosted OpenAI-compatible API".into(),
                detect: DetectConfig {
                    binary: Some("local-ai".into()),
                    process_name: Some("local-ai".into()),
                },
                custom: None,
            },
            ServiceDefinition {
                id: "jupyter".into(),
                name: "Jupyter".into(),
                default_port: 8888,
                category: "dev".into(),
                description: "Interactive notebook environment".into(),
                detect: DetectConfig {
                    binary: Some("jupyter".into()),
                    process_name: Some("jupyter".into()),
                },
                custom: None,
            },
            ServiceDefinition {
                id: "vscode-server".into(),
                name: "VS Code Server".into(),
                default_port: 8080,
                category: "dev".into(),
                description: "Browser-based VS Code".into(),
                detect: DetectConfig {
                    binary: Some("code-server".into()),
                    process_name: Some("code-server".into()),
                },
                custom: None,
            },
            ServiceDefinition {
                id: "n8n".into(),
                name: "n8n".into(),
                default_port: 5678,
                category: "dev".into(),
                description: "Workflow automation platform".into(),
                detect: DetectConfig {
                    binary: Some("n8n".into()),
                    process_name: Some("n8n".into()),
                },
                custom: None,
            },
            ServiceDefinition {
                id: "grafana".into(),
                name: "Grafana".into(),
                default_port: 3000,
                category: "monitoring".into(),
                description: "Observability and dashboarding platform".into(),
                detect: DetectConfig {
                    binary: Some("grafana-server".into()),
                    process_name: Some("grafana-server".into()),
                },
                custom: None,
            },
            ServiceDefinition {
                id: "home-assistant".into(),
                name: "Home Assistant".into(),
                default_port: 8123,
                category: "media".into(),
                description: "Home automation platform".into(),
                detect: DetectConfig {
                    binary: None,
                    process_name: Some("hass".into()),
                },
                custom: None,
            },
            ServiceDefinition {
                id: "plex".into(),
                name: "Plex".into(),
                default_port: 32400,
                category: "media".into(),
                description: "Media server and streaming platform".into(),
                detect: DetectConfig {
                    binary: None,
                    process_name: Some("Plex Media Server".into()),
                },
                custom: None,
            },
            ServiceDefinition {
                id: "minio".into(),
                name: "MinIO".into(),
                default_port: 9000,
                category: "database".into(),
                description: "S3-compatible object storage".into(),
                detect: DetectConfig {
                    binary: Some("minio".into()),
                    process_name: Some("minio".into()),
                },
                custom: None,
            },
            ServiceDefinition {
                id: "postgresql".into(),
                name: "PostgreSQL".into(),
                default_port: 5432,
                category: "database".into(),
                description: "Relational database".into(),
                detect: DetectConfig {
                    binary: Some("psql".into()),
                    process_name: Some("postgres".into()),
                },
                custom: None,
            },
            ServiceDefinition {
                id: "redis".into(),
                name: "Redis".into(),
                default_port: 6379,
                category: "database".into(),
                description: "In-memory data store".into(),
                detect: DetectConfig {
                    binary: Some("redis-cli".into()),
                    process_name: Some("redis-server".into()),
                },
                custom: None,
            },
            ServiceDefinition {
                id: "mongodb".into(),
                name: "MongoDB".into(),
                default_port: 27017,
                category: "database".into(),
                description: "Document database".into(),
                detect: DetectConfig {
                    binary: Some("mongosh".into()),
                    process_name: Some("mongod".into()),
                },
                custom: None,
            },
            ServiceDefinition {
                id: "elasticsearch".into(),
                name: "Elasticsearch".into(),
                default_port: 9200,
                category: "database".into(),
                description: "Search and analytics engine".into(),
                detect: DetectConfig {
                    binary: None,
                    process_name: Some("elasticsearch".into()),
                },
                custom: None,
            },
        ],
    }
}

// --- Registry I/O ---

/// Validate a service definition's detect fields to prevent injection
/// of malicious patterns via a tampered registry file.
fn validate_service_detect(def: &ServiceDefinition) -> bool {
    if let Some(ref bin) = def.detect.binary {
        if validate_binary_name(bin).is_err() {
            return false;
        }
    }
    // Custom services must pass strict process name validation.
    // Builtin services may use regex patterns (e.g. "python.*comfyui")
    // which are hardcoded and trusted, so we only validate custom entries.
    if def.custom == Some(true) {
        if let Some(ref pn) = def.detect.process_name {
            if validate_process_name(pn).is_err() {
                return false;
            }
        }
    }
    true
}

fn load_registry() -> ServiceRegistry {
    let path = config::services_registry_path();
    if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str::<ServiceRegistry>(&content) {
                Ok(mut reg) => {
                    // Strip any entries that fail validation (tampered file defense)
                    reg.services.retain(|def| validate_service_detect(def));
                    return reg;
                }
                Err(_) => {
                    // Corrupt registry — regenerate defaults below
                }
            },
            Err(_) => {
                // Unreadable registry — regenerate defaults below
            }
        }
    }

    let registry = default_registry();
    save_registry(&registry).ok();
    registry
}

fn save_registry(registry: &ServiceRegistry) -> Result<(), String> {
    let path = config::services_registry_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create registry directory: {}", e))?;
    }

    let json = serde_json::to_string_pretty(registry)
        .map_err(|e| format!("Failed to serialize registry: {}", e))?;

    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, &json)
        .map_err(|e| format!("Failed to write registry: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Failed to set registry permissions: {}", e))?;
    }

    std::fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to save registry: {}", e))?;

    Ok(())
}

// --- Detection ---

fn detect_service(def: &ServiceDefinition) -> DetectedService {
    let mut status = "not_found".to_string();
    let mut detected_port: Option<u16> = None;

    // Step 1: Check if binary is installed via `which`
    let installed = def.detect.binary.as_ref().map_or(false, |bin| {
        std::process::Command::new("which")
            .arg(bin)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    });

    // Step 2: Check if process is running via `pgrep` and find its port
    let running = if let Some(proc_name) = &def.detect.process_name {
        if let Some(pid) = find_process_pid(proc_name) {
            // Step 3: Find actual port via lsof
            detected_port = find_listening_port(pid).or_else(|| {
                // Fallback: probe default port
                if tcp_probe(def.default_port) {
                    Some(def.default_port)
                } else {
                    None
                }
            });
            true
        } else {
            false
        }
    } else {
        false
    };

    // Step 4: If not found via process, try TCP probe on default port
    if !running && detected_port.is_none() && tcp_probe(def.default_port) {
        detected_port = Some(def.default_port);
        status = "running".to_string();
    } else if running {
        status = "running".to_string();
    } else if installed {
        status = "installed".to_string();
    }

    DetectedService {
        id: def.id.clone(),
        name: def.name.clone(),
        category: def.category.clone(),
        description: def.description.clone(),
        default_port: def.default_port,
        detected_port,
        status,
        source: if def.custom == Some(true) { "custom" } else { "builtin" }.to_string(),
        tunnel_id: None,
        tunnel_fqdn: None,
    }
}

/// Run a command with a timeout, killing the child if it exceeds the limit.
fn run_with_timeout(cmd: &mut std::process::Command, timeout: Duration) -> Option<std::process::Output> {
    let mut child = cmd.spawn().ok()?;
    let deadline = std::time::Instant::now() + timeout;

    // Poll until the child exits or the deadline is reached
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                // Child has exited — collect remaining output
                return child.wait_with_output().ok();
            }
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return None,
        }
    }
}

fn find_process_pid(process_name: &str) -> Option<u32> {
    let output = run_with_timeout(
        std::process::Command::new("pgrep")
            .args(["-f", process_name])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped()),
        Duration::from_secs(5),
    )?;

    if !output.status.success() {
        return None;
    }

    // Get our own PID to filter it out — pgrep -f can match itself or our process
    let own_pid = std::process::id();

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Ok(pid) = line.trim().parse::<u32>() {
            if pid != own_pid {
                return Some(pid);
            }
        }
    }

    None
}

fn find_listening_port(pid: u32) -> Option<u16> {
    let output = run_with_timeout(
        std::process::Command::new("lsof")
            .args(["-anP", "-iTCP", "-sTCP:LISTEN", "-p", &pid.to_string()])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped()),
        Duration::from_secs(5),
    )?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Parse lsof output lines like: process PID user FD type device size/off node name
    // The name column contains e.g. *:11434 or 127.0.0.1:8080
    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if let Some(name) = parts.last() {
            if let Some(port_str) = name.rsplit(':').next() {
                if let Ok(port) = port_str.parse::<u16>() {
                    return Some(port);
                }
            }
        }
    }

    None
}

fn tcp_probe(port: u16) -> bool {
    let addr = format!("127.0.0.1:{}", port);
    TcpStream::connect_timeout(
        &addr.parse().expect("valid loopback address"),
        Duration::from_millis(200),
    )
    .is_ok()
}

// --- Docker scanning ---

fn scan_docker() -> Vec<DockerContainer> {
    let output = match run_with_timeout(
        std::process::Command::new("docker")
            .args(["ps", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped()),
        Duration::from_secs(10),
    ) {
        Some(o) if o.status.success() => o,
        _ => return Vec::new(),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut containers = Vec::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 5 {
            continue;
        }

        let ports = parse_docker_ports(parts[3]);

        containers.push(DockerContainer {
            id: parts[0].to_string(),
            name: parts[1].to_string(),
            image: parts[2].to_string(),
            ports,
            status: parts[4].to_string(),
            tunnel_id: None,
            tunnel_fqdn: None,
        });
    }

    containers
}

fn parse_docker_ports(port_str: &str) -> Vec<DockerPort> {
    let mut ports = Vec::new();

    for mapping in port_str.split(", ") {
        // Format: 0.0.0.0:8080->80/tcp or :::8080->80/tcp
        if let Some(arrow_pos) = mapping.find("->") {
            let host_part = &mapping[..arrow_pos];
            let container_part = &mapping[arrow_pos + 2..];

            let host_port = host_part
                .rsplit(':')
                .next()
                .and_then(|p| p.parse::<u16>().ok());

            let (container_port, protocol) = if let Some(slash_pos) = container_part.find('/') {
                (
                    container_part[..slash_pos].parse::<u16>().ok(),
                    container_part[slash_pos + 1..].to_string(),
                )
            } else {
                (container_part.parse::<u16>().ok(), "tcp".to_string())
            };

            if let (Some(hp), Some(cp)) = (host_port, container_port) {
                ports.push(DockerPort {
                    host_port: hp,
                    container_port: cp,
                    protocol,
                });
            }
        }
    }

    ports
}

// --- Tunnel matching ---

fn fetch_tunnels_for_matching() -> Vec<TunnelInfo> {
    let cfg = match config::load_config() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let body = match curl_panel(&cfg, "GET", "/api/tunnels", None) {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };

    match serde_json::from_str::<TunnelsResponse>(&body) {
        Ok(data) => data.tunnels,
        Err(_) => Vec::new(),
    }
}

fn match_tunnels(
    services: &mut [DetectedService],
    containers: &mut [DockerContainer],
    tunnels: &[TunnelInfo],
) {
    for service in services.iter_mut() {
        let port_to_match = service.detected_port.unwrap_or(service.default_port) as u32;
        if let Some(t) = tunnels.iter().find(|t| t.port == Some(port_to_match)) {
            service.tunnel_id = t.id.clone();
            service.tunnel_fqdn = t.fqdn.clone();
        }
    }

    for container in containers.iter_mut() {
        for port in &container.ports {
            if let Some(t) = tunnels.iter().find(|t| t.port == Some(port.host_port as u32)) {
                container.tunnel_id = t.id.clone();
                container.tunnel_fqdn = t.fqdn.clone();
                break;
            }
        }
    }
}

// --- Tauri commands ---

#[tauri::command]
pub async fn scan_services() -> Result<ScanResult, String> {
    let (services_result, docker_result, tunnels_result) = tokio::join!(
        tokio::task::spawn_blocking(|| {
            let registry = load_registry();
            registry
                .services
                .iter()
                .map(|def| detect_service(def))
                .collect::<Vec<_>>()
        }),
        tokio::task::spawn_blocking(scan_docker),
        tokio::task::spawn_blocking(fetch_tunnels_for_matching),
    );

    let mut services = services_result.map_err(|e| format!("Service scan failed: {}", e))?;
    let mut docker_containers = docker_result.map_err(|e| format!("Docker scan failed: {}", e))?;
    let tunnels = tunnels_result.map_err(|e| format!("Tunnel fetch failed: {}", e))?;

    match_tunnels(&mut services, &mut docker_containers, &tunnels);

    Ok(ScanResult {
        services,
        docker_containers,
    })
}

#[tauri::command]
pub async fn get_service_registry() -> Result<ServiceRegistry, String> {
    let registry =
        tokio::task::spawn_blocking(load_registry).await.map_err(|e| e.to_string())?;
    Ok(registry)
}

#[tauri::command]
pub async fn add_custom_service(
    name: String,
    port: u16,
    binary: Option<String>,
    process_name: Option<String>,
    category: String,
    description: String,
) -> Result<ServiceDefinition, String> {
    // Validate inputs
    if name.is_empty() || name.len() > MAX_NAME_LEN {
        return Err(format!("Name must be 1-{} characters", MAX_NAME_LEN));
    }
    if description.len() > MAX_DESCRIPTION_LEN {
        return Err(format!("Description must be at most {} characters", MAX_DESCRIPTION_LEN));
    }
    if !VALID_CATEGORIES.contains(&category.as_str()) {
        return Err(format!("Category must be one of: {}", VALID_CATEGORIES.join(", ")));
    }
    if let Some(ref bin) = binary {
        validate_binary_name(bin)?;
    }
    if let Some(ref pn) = process_name {
        validate_process_name(pn)?;
    }

    let id = sanitize_id(&name)?;

    let def = ServiceDefinition {
        id: id.clone(),
        name,
        default_port: port,
        category,
        description,
        detect: DetectConfig {
            binary,
            process_name,
        },
        custom: Some(true),
    };

    let new_def = def.clone();
    tokio::task::spawn_blocking(move || {
        let _lock = REGISTRY_LOCK.lock().map_err(|e| format!("Registry lock poisoned: {}", e))?;

        let mut registry = load_registry();

        let custom_count = registry.services.iter().filter(|s| s.custom == Some(true)).count();
        if custom_count >= MAX_CUSTOM_SERVICES {
            return Err(format!("Maximum of {} custom services reached", MAX_CUSTOM_SERVICES));
        }

        if registry.services.iter().any(|s| s.id == id) {
            return Err(format!("Service with id '{}' already exists", id));
        }

        registry.services.push(def);
        save_registry(&registry)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(new_def)
}

#[tauri::command]
pub async fn remove_custom_service(id: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let _lock = REGISTRY_LOCK.lock().map_err(|e| format!("Registry lock poisoned: {}", e))?;

        let mut registry = load_registry();

        let idx = registry
            .services
            .iter()
            .position(|s| s.id == id)
            .ok_or_else(|| format!("Service '{}' not found", id))?;

        if registry.services[idx].custom != Some(true) {
            return Err(format!("Cannot remove built-in service '{}'", id));
        }

        registry.services.remove(idx);
        save_registry(&registry)?;
        Ok(format!("Service '{}' removed", id))
    })
    .await
    .map_err(|e| e.to_string())?
}
