//! Locating the Node CLIs the desktop app drives (`lamaste-cloud`,
//! `create-lamaste-admin`).

use std::path::PathBuf;

/// Resolve a Node CLI entry point to an absolute path that `node <path>` can run.
///
/// `workspace_rel` is the script's path relative to `packages/` in the
/// monorepo; it is tried first (CARGO_MANIFEST_DIR is baked at compile time,
/// so it is found whenever the app runs on the machine that built it).
/// Otherwise the globally installed `bin_name` is located on PATH — `node`
/// resolves a bare name against the working directory, never PATH, so the
/// name itself is not a usable fallback.
pub fn resolve_node_cli(workspace_rel: &str, bin_name: &str, package: &str) -> Result<PathBuf, String> {
    let workspace_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join(workspace_rel);
    if let Ok(canonical) = workspace_path.canonicalize() {
        if canonical.is_file() {
            return Ok(canonical);
        }
    }

    let output = std::process::Command::new("which")
        .arg(bin_name)
        .output()
        .map_err(|e| format!("Failed to locate {}: {}", bin_name, e))?;
    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            return Ok(PathBuf::from(path));
        }
    }

    Err(format!(
        "{} not found. Install it with: npm install -g {}",
        bin_name, package
    ))
}
