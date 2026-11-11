//! Branding primitives — single source of truth for the lamalibre / lamaste
//! namespace split. Mirrors `@lamalibre/lamaste`'s `branding.ts`.
//!
//! Ecosystem-level surfaces (cloud creds, storage, local plugin host, deep-link
//! scheme) use `ORG`. Product-level surfaces (lamaste PKI, panel, agent, daemons)
//! nest under `ORG.PROJECT`.

#![allow(dead_code)]

use std::path::PathBuf;

pub const ORG: &str = "lamalibre";
pub const PROJECT: &str = "lamaste";

pub fn ecosystem_bundle_id(service: &str) -> String {
    format!("com.{}.{}", ORG, service)
}

pub fn product_bundle_id(service: &str) -> String {
    format!("com.{}.{}.{}", ORG, PROJECT, service)
}

pub fn ecosystem_unit(service: &str) -> String {
    format!("{}-{}", ORG, service)
}

pub fn product_unit(service: &str) -> String {
    format!("{}-{}-{}", ORG, PROJECT, service)
}

// ---------------------------------------------------------------------------
// Filesystem roots — mirror userEcosystemRoot/userProductRoot/etc* in branding.ts
// ---------------------------------------------------------------------------

/// User ecosystem root: `~/.${ORG}/`
pub fn user_ecosystem_root() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(format!(".{}", ORG)))
}

/// User product root: `~/.${ORG}/${PROJECT}/`
pub fn user_product_root() -> Option<PathBuf> {
    user_ecosystem_root().map(|p| p.join(PROJECT))
}

/// System ecosystem root: `/etc/${ORG}/`
pub fn etc_ecosystem_root() -> PathBuf {
    PathBuf::from(format!("/etc/{}", ORG))
}

/// System product root: `/etc/${ORG}/${PROJECT}/`
pub fn etc_product_root() -> PathBuf {
    etc_ecosystem_root().join(PROJECT)
}

// ---------------------------------------------------------------------------
// Where @lamalibre packages come from — mirrors `LAMALIBRE_REGISTRY_URL` in
// branding.ts and the rule of `lamalibre-registry.ts`; tested against the
// shared `packages/core/lib/test/fixtures/lamalibre-registry-cases.json`.
// ---------------------------------------------------------------------------

/// The registry Lamalibre's own `@lamalibre/*` packages are published to and
/// installed from: the hosted Feria (anonymous reads of public packages).
pub const LAMALIBRE_REGISTRY_URL: &str = "https://feria.codelama.com.tr/";

/// The npm configuration key routing Lamaste's scope.
pub const LAMALIBRE_REGISTRY_CONFIG_KEY: &str = "@lamalibre:registry";

/// The environment variable npm reads [`LAMALIBRE_REGISTRY_CONFIG_KEY`] from.
pub const LAMALIBRE_REGISTRY_ENV: &str = "npm_config_@lamalibre:registry";

/// Public registries where anyone may publish (or mirrors of one): never a
/// source of Lamaste's packages.
const PUBLIC_NPM_REGISTRY_HOSTS: [&str; 4] = [
    "registry.npmjs.org",
    "registry.npmjs.com",
    "registry.yarnpkg.com",
    "registry.npmmirror.com",
];

/// The registry to install `@lamalibre` from, given what
/// `npm config get @lamalibre:registry` printed (`undefined` when unset):
/// unset → the hosted Feria; a public registry or a non-http(s) value →
/// refused; anything else (a development Feria) → that registry, ending in `/`.
pub fn choose_lamalibre_registry(configured: &str) -> Result<String, String> {
    let value = configured.trim();
    if value.is_empty() || value == "undefined" || value == "null" {
        return Ok(LAMALIBRE_REGISTRY_URL.to_string());
    }
    let mut url = url::Url::parse(value).map_err(|_| {
        format!(
            "npm's {LAMALIBRE_REGISTRY_CONFIG_KEY} is not a URL — remove it, or set it to {LAMALIBRE_REGISTRY_URL}"
        )
    })?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err(format!(
            "npm's {LAMALIBRE_REGISTRY_CONFIG_KEY} is not an http(s) URL — remove it, or set it to {LAMALIBRE_REGISTRY_URL}"
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(format!(
            "npm's {LAMALIBRE_REGISTRY_CONFIG_KEY} carries credentials in the URL — put the token in an _authToken line instead"
        ));
    }
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    if PUBLIC_NPM_REGISTRY_HOSTS.contains(&host.as_str()) {
        return Err(format!(
            "npm's {LAMALIBRE_REGISTRY_CONFIG_KEY} names {host}, which no longer carries Lamaste's packages — remove the line, or set it to {LAMALIBRE_REGISTRY_URL}"
        ));
    }
    url.set_query(None);
    url.set_fragment(None);
    let href = url.to_string();
    Ok(if href.ends_with('/') {
        href
    } else {
        format!("{href}/")
    })
}

/// The registry `@lamalibre` installs from on this machine: npm's own
/// configuration (`npm config get @lamalibre:registry` — how a development
/// Feria takes over: `feria-server setup` writes the line), refused when it
/// names a public registry, else the hosted Feria. Blocking; call it from
/// `spawn_blocking`.
pub fn resolve_lamalibre_registry(npm: &str) -> Result<String, String> {
    let output = std::process::Command::new(npm)
        .args(["config", "get", LAMALIBRE_REGISTRY_CONFIG_KEY])
        .output()
        .map_err(|e| {
            format!("npm config get {LAMALIBRE_REGISTRY_CONFIG_KEY} failed to start: {e}")
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "npm config get {LAMALIBRE_REGISTRY_CONFIG_KEY} failed: {}",
            stderr.trim()
        ));
    }
    choose_lamalibre_registry(&String::from_utf8_lossy(&output.stdout))
}

/// The npm command-line option routing `@lamalibre` to `registry`.
pub fn lamalibre_registry_arg(registry: &str) -> String {
    format!("--{LAMALIBRE_REGISTRY_CONFIG_KEY}={registry}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const CASES: &str =
        include_str!("../../../../core/lib/test/fixtures/lamalibre-registry-cases.json");

    #[test]
    fn the_shared_registry_cases() {
        let f: serde_json::Value = serde_json::from_str(CASES).expect("the case table parses");
        assert_eq!(f["default"].as_str(), Some(LAMALIBRE_REGISTRY_URL));
        for case in f["cases"].as_array().unwrap() {
            let configured = case["configured"].as_str().unwrap();
            let chosen = choose_lamalibre_registry(configured);
            if case["refused"].as_bool() == Some(true) {
                assert!(
                    chosen.is_err(),
                    "{configured:?} must be refused, got {chosen:?}"
                );
            } else {
                assert_eq!(
                    chosen.as_deref(),
                    Ok(case["registry"].as_str().unwrap()),
                    "{configured:?}"
                );
            }
        }
    }

    #[test]
    fn the_npm_forms() {
        assert_eq!(
            lamalibre_registry_arg(LAMALIBRE_REGISTRY_URL),
            "--@lamalibre:registry=https://feria.codelama.com.tr/"
        );
        assert_eq!(
            LAMALIBRE_REGISTRY_ENV,
            format!("npm_config_{LAMALIBRE_REGISTRY_CONFIG_KEY}")
        );
    }

    #[test]
    fn a_refusal_never_echoes_credentials() {
        let err = choose_lamalibre_registry("https://user:secret@feria.example.org/").unwrap_err();
        assert!(!err.contains("secret"));
    }
}
