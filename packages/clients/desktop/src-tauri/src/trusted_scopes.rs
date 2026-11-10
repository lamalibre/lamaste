//! Trusted publisher scopes — the Rust twin of core `trusted-scopes.ts`.
//!
//! A plugin package is trusted when it is a well-formed scoped npm name
//! (`@<scope>/<name>`, lowercase ASCII) whose scope *equals* one of the
//! trusted scopes. `@lamalibre` is always trusted. Nothing here case-folds
//! or normalises: an upper-case or non-ASCII character makes a name
//! malformed, so look-alikes (`@LamaLibre/x`, `@lamalıbre/x`, full-width
//! `＠`) never match, and a prefix (`@lamalibre-evil/x`) is another scope.
//!
//! The desktop only pre-checks: the local plugin host (core
//! `localPluginConfig`) decides. Both read the same list,
//! `~/.lamalibre/local/trusted-scopes.json`; both are tested against
//! `packages/core/lib/test/fixtures/trusted-scopes-cases.json`.

use std::path::PathBuf;

/// The scope that is always trusted: Lamaste's own publisher.
pub const BUILTIN_TRUSTED_SCOPE: &str = "@lamalibre";

const MAX_ADDITIONAL_TRUSTED_SCOPES: usize = 16;

fn is_lower_alnum(b: u8) -> bool {
    b.is_ascii_lowercase() || b.is_ascii_digit()
}

/// `@` + `[a-z0-9][a-z0-9-]{0,49}` — the npm scope syntax Lamaste accepts.
pub fn is_npm_scope(scope: &str) -> bool {
    let bytes = scope.as_bytes();
    if bytes.len() < 2 || bytes.len() > 51 || bytes[0] != b'@' || !is_lower_alnum(bytes[1]) {
        return false;
    }
    bytes[2..].iter().all(|&b| is_lower_alnum(b) || b == b'-')
}

/// `[a-z0-9][a-z0-9._-]{0,213}`.
fn is_package_part(name: &str) -> bool {
    let bytes = name.as_bytes();
    if bytes.is_empty() || bytes.len() > 214 || !is_lower_alnum(bytes[0]) {
        return false;
    }
    bytes[1..]
        .iter()
        .all(|&b| is_lower_alnum(b) || b == b'.' || b == b'_' || b == b'-')
}

/// `@[A-Za-z0-9._-]+` — a version or tag suffix (no `:`, so no alias).
fn is_version_suffix(suffix: &str) -> bool {
    !suffix.is_empty()
        && suffix
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
}

/// The scope of a well-formed scoped package name (a version suffix is
/// allowed); `None` for anything else.
pub fn package_scope(name: &str) -> Option<&str> {
    if name.len() > 300 {
        return None;
    }
    let slash = name.find('/')?;
    let (scope, rest) = (&name[..slash], &name[slash + 1..]);
    if !is_npm_scope(scope) {
        return None;
    }
    let (package, version) = match rest.find('@') {
        Some(at) => (&rest[..at], Some(&rest[at + 1..])),
        None => (rest, None),
    };
    if !is_package_part(package) {
        return None;
    }
    if let Some(v) = version {
        if !is_version_suffix(v) {
            return None;
        }
    }
    Some(scope)
}

/// Whether `name` is a well-formed scoped package of one of `trusted`.
pub fn is_trusted_package(name: &str, trusted: &[String]) -> bool {
    match package_scope(name) {
        Some(scope) => trusted.iter().any(|t| t == scope),
        None => false,
    }
}

/// `@lamalibre`, then the well-formed additional scopes, once each.
pub fn effective_trusted_scopes(additional: &[String]) -> Vec<String> {
    let mut out = vec![BUILTIN_TRUSTED_SCOPE.to_string()];
    for scope in additional.iter().take(MAX_ADDITIONAL_TRUSTED_SCOPES) {
        if is_npm_scope(scope) && !out.contains(scope) {
            out.push(scope.clone());
        }
    }
    out
}

/// `~/.lamalibre/local/trusted-scopes.json`.
fn local_trusted_scopes_file() -> PathBuf {
    crate::config::local_dir().join("trusted-scopes.json")
}

/// The additional scopes a local list file holds; empty when the text is
/// not a valid list (never widens trust on a parse error).
fn parse_local_additional(text: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
        return Vec::new();
    };
    let Some(list) = value.get("additional").and_then(|a| a.as_array()) else {
        return Vec::new();
    };
    let scopes: Vec<String> = list
        .iter()
        .filter_map(|s| s.as_str().map(str::to_string))
        .collect();
    // The whole list or nothing, like core's schema: one bad entry, a repeat
    // or the built-in scope means the file was not written by Lamaste.
    let unique = scopes.iter().collect::<std::collections::HashSet<_>>().len() == scopes.len();
    if scopes.len() != list.len()
        || scopes.len() > MAX_ADDITIONAL_TRUSTED_SCOPES
        || !unique
        || scopes.iter().any(|s| !is_npm_scope(s) || s == BUILTIN_TRUSTED_SCOPE)
    {
        return Vec::new();
    }
    scopes
}

/// The local plugin host's effective trusted scopes; `@lamalibre` alone
/// when the list is missing or unreadable.
pub fn local_trusted_scopes() -> Vec<String> {
    let additional = std::fs::read_to_string(local_trusted_scopes_file())
        .map(|text| parse_local_additional(&text))
        .unwrap_or_default();
    effective_trusted_scopes(&additional)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CASES: &str = include_str!("../../../../core/lib/test/fixtures/trusted-scopes-cases.json");

    fn fixture() -> serde_json::Value {
        serde_json::from_str(CASES).expect("the shared case table parses")
    }

    #[test]
    fn the_shared_package_cases() {
        let f = fixture();
        let trusted: Vec<String> = f["trusted"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap().to_string())
            .collect();
        for case in f["cases"].as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            let scope = case["scope"].as_str();
            let expected = case["trusted"].as_bool().unwrap();
            assert_eq!(package_scope(name), scope, "scope of {:?}", name);
            assert_eq!(is_trusted_package(name, &trusted), expected, "trust of {:?}", name);
            assert_eq!(
                is_trusted_package(name, &effective_trusted_scopes(&[])),
                expected && scope == Some(BUILTIN_TRUSTED_SCOPE),
                "built-in only: {:?}",
                name
            );
        }
    }

    #[test]
    fn the_shared_scope_cases() {
        for case in fixture()["scopes"].as_array().unwrap() {
            let scope = case["scope"].as_str().unwrap();
            assert_eq!(is_npm_scope(scope), case["valid"].as_bool().unwrap(), "{:?}", scope);
        }
    }

    #[test]
    fn the_local_list_is_all_or_nothing() {
        assert_eq!(parse_local_additional(r#"{"additional":["@example"]}"#), vec!["@example"]);
        assert!(parse_local_additional(r#"{"additional":["@example","@Bad"]}"#).is_empty());
        assert!(parse_local_additional(r#"{"additional":["@example","@example"]}"#).is_empty());
        assert!(parse_local_additional(r#"{"additional":["@lamalibre"]}"#).is_empty());
        assert!(parse_local_additional(r#"{"additional":[1]}"#).is_empty());
        assert!(parse_local_additional("not json").is_empty());
        assert!(parse_local_additional("{}").is_empty());
        assert_eq!(
            effective_trusted_scopes(&["@example".to_string(), "@lamalibre".to_string()]),
            vec!["@lamalibre", "@example"]
        );
    }
}
