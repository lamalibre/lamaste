#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod chisel;
mod tray;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            tray::setup_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running portlama desktop");
}
