//! URL helpers shared by panel-talking modules.
//!
//! Historically this module hosted Tauri commands for the legacy single-agent
//! plugin path (`get_plugins`, `install_plugin`, etc.). Those commands were
//! replaced by `admin_commands::admin_*_plugin`, `local_plugins::local_*`,
//! and `agents::*_agent_plugin` after the multi-agent refactor. The only
//! surviving piece of this module is `url_encode`, which `admin_commands`
//! still depends on for percent-encoding URL path segments.

/// Percent-encode a string for safe use in URL path segments.
pub(crate) fn url_encode(s: &str) -> String {
    let mut encoded = String::with_capacity(s.len());
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(byte as char);
            }
            _ => {
                encoded.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    encoded
}
