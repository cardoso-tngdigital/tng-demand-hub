// =============================================================================
// TNG Sites — Demandas — Tauri Core
// =============================================================================
// Responsabilidades:
// - Inicializar plugins (opener, notification, updater, process, dialog,
//   global-shortcut).
// - Registrar dinamicamente o atalho global da captura via comando
//   set_capture_hotkey(accelerator). O frontend chama no boot e cada vez
//   que o user troca de combinação no modal de configuração.
// - Comandos: hide_capture_window, set_tray_badge, read_file_bytes,
//   set_capture_hotkey.
// - Tray icon com menu (Abrir / Nova captura / Sair).
//
// Sobre dupla pressão de tecla isolada (ctrl+ctrl, alt+alt etc.):
// uma versão anterior tentava isso via crate rdev. No macOS, rdev::listen
// só funciona corretamente quando chamado da main thread (usa CGEventTap +
// CFRunLoop), e a main thread do Tauri já está ocupada pelo Builder::run.
// Chamar de uma thread spawn provoca crash em qualquer keypress. Voltamos
// pro plugin oficial do Tauri (combinação tradicional Cmd+Shift+X) que é
// robusto e multiplataforma.
// =============================================================================

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

// ---------------------------------------------------------------------------
// Comandos do frontend
// ---------------------------------------------------------------------------

#[tauri::command]
fn hide_capture_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn set_tray_badge(app: tauri::AppHandle, count: u32) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let title = if count == 0 { None } else { Some(count.to_string()) };
        let _ = tray.set_title(title.as_deref());
    }
}

// Lê um arquivo do disco via std::fs (o webview do macOS falha com
// "I/O read operation failed" em alguns PDFs). Devolve bytes brutos
// que o frontend converte em File na memória.
//
// Faz até 3 tentativas com 2s de espera quando recebe ETIMEDOUT — caso
// típico de arquivos "on-demand" no Google Drive File Stream / iCloud
// Drive: a primeira leitura dispara o download em background e os
// kernels do macOS retornam ETIMEDOUT em vez de bloquear até concluir.
#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    let max_attempts = 3u32;
    let mut last_error: Option<std::io::Error> = None;
    for attempt in 1..=max_attempts {
        match std::fs::read(&path) {
            Ok(bytes) => return Ok(bytes),
            Err(err) => {
                let is_timeout = err.kind() == std::io::ErrorKind::TimedOut
                    || err.raw_os_error() == Some(60);
                if is_timeout && attempt < max_attempts {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    last_error = Some(err);
                    continue;
                }
                return Err(format!(
                    "{} (após {} tentativa{}{})",
                    err,
                    attempt,
                    if attempt == 1 { "" } else { "s" },
                    if path.contains("/CloudStorage/")
                        || path.contains("/Mobile Documents/")
                    {
                        " — arquivo está no Google Drive ou iCloud. Marque \"Disponibilizar Offline\" no Finder e tente de novo"
                    } else {
                        ""
                    }
                ));
            }
        }
    }
    Err(last_error
        .map(|e| e.to_string())
        .unwrap_or_else(|| "Falha desconhecida ao ler arquivo".to_string()))
}

// Re-registra dinamicamente o atalho da captura. Frontend chama no boot
// (com o accelerator salvo em localStorage) e cada vez que o user troca
// no modal de configuração. Aceita formato do Tauri global-shortcut:
// "CmdOrCtrl+Shift+D", "Cmd+Shift+Space", "F12", "Alt+G", etc.
#[cfg(desktop)]
#[tauri::command]
fn set_capture_hotkey(
    app: tauri::AppHandle,
    accelerator: String,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    // Sempre limpa o registrado anterior — só um atalho vivo por vez.
    let _ = gs.unregister_all();
    gs.register(accelerator.as_str()).map_err(|e| e.to_string())
}

#[cfg(not(desktop))]
#[tauri::command]
fn set_capture_hotkey(_app: tauri::AppHandle, _accelerator: String) -> Result<(), String> {
    Err("Atalho global não suportado nesta plataforma".to_string())
}

// ---------------------------------------------------------------------------
// Helpers de janela
// ---------------------------------------------------------------------------

fn show_capture_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.center();
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            hide_capture_window,
            set_tray_badge,
            read_file_bytes,
            set_capture_hotkey,
        ]);

    // Plugin de atalho global (apenas desktop). Sem with_shortcuts: o atalho
    // é registrado dinamicamente pelo frontend via set_capture_hotkey no
    // boot. Handler único — qualquer atalho ativo dispara show_capture_window.
    #[cfg(desktop)]
    {
        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
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
            let abrir_item = MenuItem::with_id(app, "open", "Abrir TNG Sites — Demandas", true, None::<&str>)?;
            let capturar_item = MenuItem::with_id(
                app,
                "capture",
                "Nova captura",
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
                .tooltip("TNG Sites — Demandas")
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
