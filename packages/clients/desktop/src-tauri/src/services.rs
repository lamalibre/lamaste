use serde::{Deserialize, Serialize};

/// Default port for the agent daemon (lamaste-agentd).
const AGENTD_PORT: u16 = 9393;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerPort {
    pub host_port: u16,
    pub container_port: u16,
    pub protocol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub services: Vec<DetectedService>,
    pub docker_containers: Vec<DockerContainer>,
}

// --- REST helper ---

/// Curl the local agentd service (plain HTTP on 127.0.0.1:9393).
///
/// Authenticates with the per-user Bearer token at `~/.lamalibre/lamaste/agentd.token`
/// (mode 0600). Service discovery is a machine-wide operation, not scoped to
/// a specific agent — the daemon attributes the call to its own `--label`.
fn curl_agentd(
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<String, String> {
    let url = format!("http://127.0.0.1:{}{}", AGENTD_PORT, path);
    let token = crate::api::agentd_token()?;

    let mut args = vec![
        "-s".to_string(),
        "-H".to_string(),
        format!("Authorization: Bearer {}", token),
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

// --- Tauri commands ---

#[tauri::command]
pub async fn scan_services() -> Result<ScanResult, String> {
    tokio::task::spawn_blocking(|| {
        let body = curl_agentd("GET", "/api/services/scan", None)?;
        serde_json::from_str::<ScanResult>(&body)
            .map_err(|e| format!("Failed to parse scan result: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn get_service_registry() -> Result<ServiceRegistry, String> {
    tokio::task::spawn_blocking(|| {
        let body = curl_agentd("GET", "/api/services/registry", None)?;
        serde_json::from_str::<ServiceRegistry>(&body)
            .map_err(|e| format!("Failed to parse service registry: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
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
    tokio::task::spawn_blocking(move || {
        let payload = serde_json::json!({
            "name": name,
            "port": port,
            "binary": binary,
            "processName": process_name,
            "category": category,
            "description": description,
        });
        let body = curl_agentd(
            "POST",
            "/api/services/custom",
            Some(&payload.to_string()),
        )?;

        // The REST API returns { ok: true, service: { ... } }
        let resp: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse response: {}", e))?;
        let service_val = resp.get("service")
            .ok_or_else(|| "Missing 'service' in response".to_string())?;
        serde_json::from_value::<ServiceDefinition>(service_val.clone())
            .map_err(|e| format!("Failed to parse service definition: {}", e))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn remove_custom_service(id: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        // Validate the id format before sending (defense in depth)
        if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return Err("Invalid service ID".to_string());
        }
        let path = format!("/api/services/custom/{}", id);
        curl_agentd("DELETE", &path, None)?;
        Ok(format!("Service '{}' removed", id))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}
