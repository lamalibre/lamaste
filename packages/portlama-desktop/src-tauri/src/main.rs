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
            cloud::store_cloud_token,
            cloud::get_cloud_token,
            cloud::delete_cloud_token,
            cloud::validate_cloud_token,
            cloud::get_cloud_regions,
            cloud::get_cloud_sizes,
            cloud::provision_server,
            cloud::destroy_cloud_server,
            cloud::get_servers,
            cloud::set_active_server,
            cloud::add_managed_server,
            cloud::remove_server,
            cloud::check_server_health,
            // Local installation
            local_install::check_local_install_available,
            local_install::start_local_install,
            local_install::import_existing_local_install,
            local_install::check_local_server_health,
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
            admin_commands::admin_update_agent_capabilities,
            admin_commands::admin_update_agent_allowed_sites,
            admin_commands::admin_download_agent_cert,
            // Admin: Services + System
            admin_commands::admin_get_services,
            admin_commands::admin_service_action,
            admin_commands::admin_get_system_stats,
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
            admin_commands::admin_enable_push_install,
            admin_commands::admin_disable_push_install,
            admin_commands::admin_push_install_command,
            admin_commands::admin_get_push_install_sessions,
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
