#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// TODO(v3): The Tauri bundle identifier `com.lamalibre.lamaste.desktop` (set
// in tauri.conf.json) is intentionally not parameterized. It drives the macOS
// app cache dir, app data dir, code-signing identity, and the `lamalibre://`
// deep-link scheme registration — renaming it strands the existing app
// installation and cache. v3 will need a fresh bundle identifier
// (`com.lamalibre.lamaste.desktop`), a new code-signing run, and a deep-link
// migration path before flipping the default.
// must match branding::product_bundle_id("desktop")
//
// Deep-link scheme: the OS-registered scheme is `lamalibre://` (ecosystem-
// level — every Lamalibre product shares it). A callback's `product=` query
// param identifies which product the callback is for; the dispatcher below
// reads that param and routes accordingly. Today the only product is
// `lamaste`, so the dispatch is a single-branch assertion. Future products
// (herd, shell, etc.) will register additional branches without needing a
// second OS scheme.

use tauri::Emitter;
use tauri::Listener;

mod admin_commands;
mod agent_client;
mod agents;
mod api;
mod branding;
mod cloud;
mod config;
mod credentials;
mod daemon_lifecycle;
mod feria;
mod local_install;
mod local_plugins;
mod mode;
mod services;
mod plugins;
mod tray;
mod upgrade_admin;
mod user_access;

/// Simple percent-decoding for URL query parameter values.
fn urlencoding_decode(input: &str) -> String {
    let mut result = Vec::new();
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(
                &input[i + 1..i + 3],
                16,
            ) {
                result.push(byte);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            result.push(b' ');
        } else {
            result.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8_lossy(&result).into_owned()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(admin_commands::LogStreamState(std::sync::Mutex::new(std::collections::HashMap::new())))
        .setup(|app| {
            tray::setup_tray(app)?;

            // Listen for deep link events. The PKCE callback shape is:
            //
            //   lamalibre://callback?product=lamaste#token=...&domain=...&nonce=...
            //
            // The query string carries the `product=` dispatch param (non-
            // secret routing metadata); the fragment carries the OTP token,
            // domain, and nonce. Fragments are not transmitted to HTTP
            // servers, are not stored in most OS URL-handler logs, and never
            // appear in third-party referrer chains — the right transport for
            // short-lived secrets in a redirect target.
            let handle = app.handle().clone();
            app.listen("deep-link://new-url", move |event| {
                if let Some(urls) = event.payload().strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
                    // Payload is a JSON array of URL strings
                    if let Ok(url_list) = serde_json::from_str::<Vec<String>>(&format!("[{}]", urls)) {
                        for url in url_list {
                            if url.starts_with("lamalibre://callback") {
                                // Strip the scheme+path prefix to isolate the
                                // query string and fragment. After this split,
                                // `tail` is "?product=lamaste#token=..." (or
                                // similar variations).
                                let tail = url
                                    .strip_prefix("lamalibre://callback")
                                    .unwrap_or("");

                                // Split off the fragment first so the query
                                // string doesn't accidentally swallow it.
                                let (head, fragment) = match tail.split_once('#') {
                                    Some((h, f)) => (h, Some(f)),
                                    None => (tail, None),
                                };

                                // Query string lives between '?' and '#'.
                                let query = head.strip_prefix('?').unwrap_or("");

                                // Dispatch by `product=`: today the only
                                // product is lamaste, so this is a single-
                                // branch assertion. Adding herd/shell/etc.
                                // later means adding more branches here, not
                                // a second OS scheme.
                                let mut product = String::new();
                                for param in query.split('&').filter(|p| !p.is_empty()) {
                                    if let Some(val) = param.strip_prefix("product=") {
                                        product = urlencoding_decode(val);
                                    }
                                }
                                if product != "lamaste" {
                                    // Either the param is missing or names a
                                    // product this build doesn't handle. Drop
                                    // the callback rather than guess —
                                    // mis-dispatching a secret to the wrong
                                    // product handler would be a bug.
                                    continue;
                                }

                                // Parse the fragment for secrets. Fall back
                                // to the query string only as a last resort
                                // for OS URL handlers that strip fragments —
                                // the panel always uses fragments, so this
                                // branch only ever fires on a hostile hand-
                                // crafted deep link, which the verifier
                                // check will then reject anyway.
                                let payload = fragment.or(if !query.is_empty() { Some(query) } else { None });
                                if let Some(payload) = payload {
                                    let mut token = String::new();
                                    let mut domain = String::new();
                                    let mut nonce = String::new();
                                    for param in payload.split('&') {
                                        if let Some(val) = param.strip_prefix("token=") {
                                            token = urlencoding_decode(val);
                                        } else if let Some(val) = param.strip_prefix("domain=") {
                                            domain = urlencoding_decode(val);
                                        } else if let Some(val) = param.strip_prefix("nonce=") {
                                            nonce = urlencoding_decode(val);
                                        }
                                    }
                                    if !token.is_empty() && !domain.is_empty() && !nonce.is_empty() {
                                        let _ = handle.emit("user-access-callback", serde_json::json!({
                                            "token": token,
                                            "domain": domain,
                                            "nonce": nonce,
                                        }));
                                    }
                                }
                            }
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tray::set_tray_state,
            services::scan_services,
            services::get_service_registry,
            services::add_custom_service,
            services::remove_custom_service,
            // Multi-agent management
            agents::get_agents,
            agents::get_agent_status,
            agents::start_agent,
            agents::stop_agent,
            agents::uninstall_agent,
            agents::restart_agent,
            agents::get_agent_tunnels,
            agents::get_agent_logs,
            agents::get_agent_config,
            agents::get_panel_expose_status,
            agents::toggle_panel_expose,
            agents::start_agent_panel,
            agents::stop_agent_panel,
            agents::install_agent,
            // Per-agent client commands (REST proxy to lamaste-agentd :9393)
            agent_client::get_status,
            agent_client::update_agent,
            agent_client::create_tunnel,
            agent_client::toggle_tunnel,
            agent_client::delete_tunnel,
            agent_client::rotate_certificate,
            agent_client::download_certificate,
            // Agent plugin management
            agents::get_agent_plugins,
            agents::install_agent_plugin,
            agents::enable_agent_plugin,
            agents::disable_agent_plugin,
            agents::uninstall_agent_plugin,
            agents::update_agent_plugin,
            agents::fetch_agent_plugin_bundle,
            agents::check_agent_plugin_update,
            cloud::store_cloud_token,
            cloud::get_cloud_token,
            cloud::delete_cloud_token,
            cloud::validate_cloud_token,
            cloud::get_cloud_regions,
            cloud::get_cloud_sizes,
            cloud::get_cloud_domains,
            cloud::get_cloud_domain_records,
            cloud::create_cloud_domain,
            cloud::provision_server,
            cloud::destroy_cloud_server,
            cloud::get_servers,
            cloud::set_active_server,
            cloud::add_managed_server,
            cloud::discover_servers,
            cloud::register_discovered_server,
            cloud::remove_server,
            // SSH recovery
            cloud::generate_recovery_ssh_key,
            cloud::test_recovery_ssh,
            cloud::recover_admin_via_ssh,
            cloud::cleanup_recovery_ssh_key,
            cloud::check_server_health,
            cloud::check_panel_update,
            cloud::update_panel_server,
            // Storage server management
            cloud::store_storage_credentials,
            cloud::get_storage_credentials,
            cloud::delete_storage_credentials,
            cloud::validate_storage_credentials,
            cloud::get_spaces_regions,
            cloud::provision_storage_server,
            cloud::get_storage_servers,
            cloud::remove_storage_server,
            cloud::destroy_storage_server,
            cloud::push_storage_to_panel,
            cloud::bind_plugin_storage,
            cloud::setup_plugin_storage,
            // Local installation
            local_install::check_local_install_available,
            local_install::start_local_install,
            local_install::import_existing_local_install,
            local_install::check_local_server_health,
            // Local plugin management
            local_plugins::local_get_plugins,
            local_plugins::local_get_available_plugins,
            local_plugins::local_install_plugin,
            local_plugins::local_uninstall_plugin,
            local_plugins::local_enable_plugin,
            local_plugins::local_disable_plugin,
            local_plugins::local_fetch_plugin_bundle,
            local_plugins::local_check_plugin_update,
            local_plugins::local_update_plugin,
            local_plugins::local_check_desktop_app,
            local_plugins::local_open_desktop_app,
            local_plugins::local_uninstall_desktop_app,
            local_plugins::local_install_desktop_app,
            local_plugins::local_read_host_logs,
            local_plugins::migrate_local_plugin_to_agent,
            // Admin certificate upgrade
            upgrade_admin::upgrade_admin_to_hardware_bound,
            // Mode switching
            mode::set_server_mode,
            mode::get_server_mode,
            mode::has_admin_cert,
            mode::import_admin_cert,
            mode::remove_admin_cert,
            // Admin: 2FA
            admin_commands::admin_2fa_status,
            admin_commands::admin_2fa_setup,
            admin_commands::admin_2fa_confirm,
            admin_commands::admin_2fa_verify,
            admin_commands::admin_2fa_disable,
            // Admin: Users
            admin_commands::admin_get_users,
            admin_commands::admin_create_user,
            admin_commands::admin_update_user,
            admin_commands::admin_delete_user,
            admin_commands::admin_reset_totp,
            // Admin: Invitations
            admin_commands::admin_get_invitations,
            admin_commands::admin_create_invitation,
            admin_commands::admin_revoke_invitation,
            // Admin: Sites
            admin_commands::admin_get_sites,
            admin_commands::admin_create_site,
            admin_commands::admin_delete_site,
            admin_commands::admin_update_site,
            admin_commands::admin_get_site_files,
            admin_commands::admin_upload_site_files,
            admin_commands::admin_delete_site_file,
            admin_commands::admin_verify_site_dns,
            // Admin: Certificates
            admin_commands::admin_get_certs,
            admin_commands::admin_renew_cert,
            admin_commands::admin_rotate_mtls,
            admin_commands::admin_download_mtls,
            admin_commands::admin_get_auth_mode,
            admin_commands::admin_get_auto_renew_status,
            admin_commands::admin_get_agent_certs,
            admin_commands::admin_generate_agent_cert,
            admin_commands::admin_revoke_agent_cert,
            admin_commands::admin_create_enrollment_token,
            admin_commands::admin_revoke_enrollment_token,
            admin_commands::admin_update_agent_capabilities,
            admin_commands::admin_update_agent_allowed_sites,
            admin_commands::admin_download_agent_cert,
            // Admin: Services + System
            admin_commands::admin_get_services,
            admin_commands::admin_service_action,
            admin_commands::admin_get_system_stats,
            admin_commands::admin_trigger_panel_update,
            // Admin: Tickets
            admin_commands::admin_get_ticket_scopes,
            admin_commands::admin_create_ticket_scope,
            admin_commands::admin_delete_ticket_scope,
            admin_commands::admin_get_ticket_instances,
            admin_commands::admin_delete_ticket_instance,
            admin_commands::admin_get_ticket_assignments,
            admin_commands::admin_create_ticket_assignment,
            admin_commands::admin_delete_ticket_assignment,
            admin_commands::admin_get_tickets,
            admin_commands::admin_revoke_ticket,
            admin_commands::admin_get_ticket_sessions,
            admin_commands::admin_kill_ticket_session,
            // Admin: Plugins
            admin_commands::admin_get_plugins,
            admin_commands::admin_install_plugin,
            admin_commands::admin_enable_plugin,
            admin_commands::admin_disable_plugin,
            admin_commands::admin_uninstall_plugin,
            admin_commands::admin_fetch_plugin_bundle,
            admin_commands::admin_get_push_install_config,
            admin_commands::admin_update_push_install_config,
            admin_commands::admin_get_push_install_policies,
            admin_commands::admin_create_push_install_policy,
            admin_commands::admin_delete_push_install_policy,
            admin_commands::admin_update_push_install_policy,
            admin_commands::admin_enable_push_install,
            admin_commands::admin_disable_push_install,
            admin_commands::admin_push_install_command,
            admin_commands::admin_get_push_install_sessions,
            // Admin: Storage
            admin_commands::admin_register_storage_server,
            admin_commands::admin_get_storage_servers,
            admin_commands::admin_delete_storage_server,
            admin_commands::admin_create_storage_binding,
            admin_commands::admin_get_storage_bindings,
            admin_commands::admin_get_storage_binding,
            admin_commands::admin_delete_storage_binding,
            // Admin: Identity
            admin_commands::admin_get_identity_self,
            admin_commands::admin_get_identity_users,
            admin_commands::admin_get_identity_user,
            admin_commands::admin_get_identity_groups,
            // Admin: Tunnels
            admin_commands::admin_get_tunnels,
            admin_commands::admin_create_tunnel,
            admin_commands::admin_toggle_tunnel,
            admin_commands::admin_delete_tunnel,
            admin_commands::admin_get_tunnel_agent_config,
            admin_commands::admin_get_mac_plist,
            // Admin: Log Streaming
            admin_commands::admin_start_log_stream,
            admin_commands::admin_stop_log_stream,
            // Admin: User Plugin Access
            admin_commands::admin_get_user_access_grants,
            admin_commands::admin_create_user_access_grant,
            admin_commands::admin_revoke_user_access_grant,
            // Admin: Gatekeeper Groups
            admin_commands::admin_get_gatekeeper_groups,
            admin_commands::admin_create_gatekeeper_group,
            admin_commands::admin_update_gatekeeper_group,
            admin_commands::admin_delete_gatekeeper_group,
            admin_commands::admin_add_gatekeeper_group_members,
            admin_commands::admin_remove_gatekeeper_group_member,
            // Admin: Gatekeeper Grants
            admin_commands::admin_get_gatekeeper_grants,
            admin_commands::admin_create_gatekeeper_grant,
            admin_commands::admin_revoke_gatekeeper_grant,
            // Admin: Gatekeeper Diagnostics + Settings
            admin_commands::admin_check_gatekeeper_access,
            admin_commands::admin_bust_gatekeeper_cache,
            admin_commands::admin_get_gatekeeper_settings,
            admin_commands::admin_update_gatekeeper_settings,
            admin_commands::admin_get_access_request_log,
            admin_commands::admin_clear_access_request_log,
            // Daemon lifecycle (sidebar footer pills)
            daemon_lifecycle::daemon_get_service_status,
            daemon_lifecycle::daemon_start,
            daemon_lifecycle::daemon_stop,
            daemon_lifecycle::daemon_restart,
            daemon_lifecycle::daemon_install,
            daemon_lifecycle::daemon_uninstall,
            // Feria dev registry lifecycle
            feria::feria_get_status,
            feria::feria_start,
            feria::feria_stop,
            feria::feria_takeover,
            // User access (Authelia login)
            user_access::user_access_start_login,
            user_access::user_access_exchange_token,
            user_access::user_access_get_session,
            user_access::user_access_logout,
            user_access::user_access_get_plugins,
            user_access::user_access_enroll_plugin,
            user_access::user_access_install_plugin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running lamaste desktop");
}
