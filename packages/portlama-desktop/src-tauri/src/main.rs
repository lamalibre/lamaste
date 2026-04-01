#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod admin_commands;
mod agents;
mod api;
mod cloud;
mod commands;
mod config;
mod chisel;
mod credentials;
mod local_install;
mod local_plugins;
mod mode;
mod services;
mod plugins;
mod tray;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(admin_commands::LogStreamState(std::sync::Mutex::new(std::collections::HashMap::new())))
        .setup(|app| {
            tray::setup_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::set_tray_state,
            commands::get_status,
            commands::get_config,
            commands::get_tunnels,
            commands::create_tunnel,
            commands::toggle_tunnel,
            commands::delete_tunnel,
            commands::stop_chisel,
            commands::start_chisel,
            commands::restart_chisel,
            commands::update_agent,
            commands::uninstall_agent,
            commands::rotate_certificate,
            commands::download_certificate,
            commands::get_panel_url,
            commands::get_logs,
            services::scan_services,
            services::get_service_registry,
            services::add_custom_service,
            services::remove_custom_service,
            plugins::get_plugins,
            plugins::install_plugin,
            plugins::enable_plugin,
            plugins::disable_plugin,
            plugins::uninstall_plugin,
            // Multi-agent management
            agents::get_agents,
            agents::get_agent_status,
            agents::start_agent,
            agents::stop_agent,
            agents::restart_agent,
            agents::get_agent_tunnels,
            agents::get_agent_logs,
            agents::get_agent_config,
            agents::get_panel_expose_status,
            agents::toggle_panel_expose,
            agents::start_agent_panel,
            agents::stop_agent_panel,
            agents::install_agent,
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
            cloud::remove_server,
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
            local_plugins::local_get_host_status,
            local_plugins::local_start_host,
            local_plugins::local_stop_host,
            local_plugins::local_get_host_logs,
            local_plugins::migrate_local_plugin_to_agent,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running portlama desktop");
}
