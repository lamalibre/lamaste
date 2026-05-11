use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
    menu::{MenuBuilder, MenuItemBuilder},
};

use crate::config;

fn icon_for_state(state: &str) -> Image<'static> {
    match state {
        "online" => Image::from_bytes(include_bytes!("../icons/tray-green.png")),
        "offline" => Image::from_bytes(include_bytes!("../icons/tray-red.png")),
        "checking" => Image::from_bytes(include_bytes!("../icons/tray-amber.png")),
        _ => Image::from_bytes(include_bytes!("../icons/tray-gray.png")),
    }
    .expect("failed to load tray icon")
}

pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let configured = config::config_path().exists();

    let initial_state = if configured { "checking" } else { "unconfigured" };
    let status_text = if configured {
        "Lamaste: Checking..."
    } else {
        "Lamaste: Not configured"
    };

    let status_item = MenuItemBuilder::with_id("status", status_text)
        .enabled(false)
        .build(app)?;

    let show_item = MenuItemBuilder::with_id("show", "Open Dashboard")
        .build(app)?;

    let quit_item = MenuItemBuilder::with_id("quit", "Quit Lamaste")
        .build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&status_item)
        .separator()
        .item(&show_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let _tray = TrayIconBuilder::with_id("main")
        .icon(icon_for_state(initial_state))
        .icon_as_template(false)
        .tooltip("Lamaste")
        .menu(&menu)
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// Update the tray icon and tooltip based on server state.
/// Called from the frontend via `set_tray_state` command.
pub fn update_tray_state(app: &tauri::AppHandle, state: &str, tooltip: &str) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_icon(Some(icon_for_state(state)));
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

#[tauri::command]
pub fn set_tray_state(app_handle: tauri::AppHandle, state: String, tooltip: String) {
    update_tray_state(&app_handle, &state, &tooltip);
}
