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
