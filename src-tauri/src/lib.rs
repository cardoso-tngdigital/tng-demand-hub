// =============================================================================
// TNG Demand Hub — Tauri Core
// =============================================================================
// Responsabilidades:
// - Inicializar plugins (global-shortcut, opener).
// - Registrar atalho global Cmd/Ctrl+Shift+D.
// - Mostrar/esconder janela de captura.
// - Criar tray icon na bandeja com menu básico.
// =============================================================================

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

// Comando invocável do frontend para esconder a janela de captura
#[tauri::command]
fn hide_capture_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.hide();
    }
}

// Mostra (e foca) a janela de captura. Se já estiver visível, apenas foca.
fn show_capture_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.center();
    }
}

// Foca a janela principal (do dashboard)
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![hide_capture_window]);

    // Plugin de atalho global (apenas desktop)
    #[cfg(desktop)]
    {
        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["CmdOrCtrl+Shift+D"])
                .expect("falha ao registrar atalho")
                .with_handler(|app, _shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    if event.state() == ShortcutState::Pressed {
                        show_capture_window(app);
                    }
                })
                .build(),
        );
    }

    builder
        .setup(|app| {
            // -----------------------------------------------------------------
            // Tray Icon — ícone na bandeja do sistema
            // -----------------------------------------------------------------
            let abrir_item = MenuItem::with_id(app, "open", "Abrir Demand Hub", true, None::<&str>)?;
            let capturar_item = MenuItem::with_id(
                app,
                "capture",
                "Nova captura  (⌘⇧D)",
                true,
                None::<&str>,
            )?;
            let separador = tauri::menu::PredefinedMenuItem::separator(app)?;
            let sair_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[&abrir_item, &capturar_item, &separador, &sair_item],
            )?;

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .tooltip("TNG Demand Hub")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "capture" => show_capture_window(app),
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Clique esquerdo no ícone abre a janela principal
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
