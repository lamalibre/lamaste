use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
    menu::{MenuBuilder, MenuItemBuilder},
};

use crate::config;

pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let configured = config::config_path().exists();

    let status_text = if configured {
        "Portlama: Checking..."
    } else {
        "Portlama: Not configured"
    };

    let status_item = MenuItemBuilder::with_id("status", status_text)
        .enabled(false)
        .build(app)?;

    let show_item = MenuItemBuilder::with_id("show", "Open Dashboard")
        .build(app)?;

    let quit_item = MenuItemBuilder::with_id("quit", "Quit Portlama")
        .build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&status_item)
        .separator()
        .item(&show_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
        .expect("failed to load tray icon");

    let _tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Portlama")
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
