// =============================================================================
// TNG Sites — Demandas — Tauri Core
// =============================================================================
// Responsabilidades:
// - Plugins: opener, notification, updater, process, dialog, global-shortcut.
// - Dois caminhos de atalho global da captura:
//     * COMBO tradicional (Cmd+Shift+D etc.) via tauri-plugin-global-shortcut.
//     * DUPLA PRESSÃO de tecla modificadora isolada (option+option, ctrl+ctrl
//       etc.) via thread de polling com APIs nativas:
//         - macOS:  core-graphics::CGEventSource::flags_state
//         - Windows: winapi::GetAsyncKeyState
//       Polling de 25ms em thread separada — sem main thread, sem CGEventTap
//       event-driven (que crashava o rdev), sem permissão Accessibility extra.
//
// Frontend escolhe qual modo está ativo via comandos:
//   - set_capture_hotkey(accelerator) — modo combo
//   - set_capture_double_tap(modifier) — modo double-tap (None desliga)
// O outro modo é desativado automaticamente.
// =============================================================================

use std::sync::atomic::{AtomicI64, AtomicU8, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

// ---------------------------------------------------------------------------
// Estado global do detector de dupla pressão
// ---------------------------------------------------------------------------
// Mode: 0 = desabilitado, 1 = ctrl, 2 = alt/option, 3 = shift, 4 = cmd/win.
// AtomicU8 evita Mutex no caminho quente do polling.
static DOUBLE_TAP_MODE: AtomicU8 = AtomicU8::new(0);
// Timestamp ms-since-epoch da última pressão observada. -1 = nenhuma ainda.
static LAST_PRESS_MS: AtomicI64 = AtomicI64::new(-1);

// Janela máxima entre as duas pressões pra considerar "dupla". 400ms é
// confortável e o que apps tipo Claude/Spotlight usam.
const DOUBLE_PRESS_WINDOW_MS: i64 = 400;
const POLL_INTERVAL: Duration = Duration::from_millis(25);

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

// Modo COMBO. Frontend chama no boot e sempre que o user muda. Ao ativar
// um combo, desliga o detector de double-tap.
#[cfg(desktop)]
#[tauri::command]
fn set_capture_hotkey(
    app: tauri::AppHandle,
    accelerator: String,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.register(accelerator.as_str()).map_err(|e| e.to_string())?;
    DOUBLE_TAP_MODE.store(0, Ordering::SeqCst);
    LAST_PRESS_MS.store(-1, Ordering::SeqCst);
    Ok(())
}

#[cfg(not(desktop))]
#[tauri::command]
fn set_capture_hotkey(_app: tauri::AppHandle, _accelerator: String) -> Result<(), String> {
    Err("Atalho global não suportado nesta plataforma".to_string())
}

// Modo DOUBLE-TAP. Aceita "ctrl" | "alt"/"option" | "shift" | "cmd"/"command".
// Passar None/null/"" desliga o detector e cai pro combo.
#[cfg(desktop)]
#[tauri::command]
fn set_capture_double_tap(
    app: tauri::AppHandle,
    modifier: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let mode = match modifier.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => 0,
        Some(m) => match m.to_lowercase().as_str() {
            "ctrl" | "control" => 1,
            "alt" | "option" => 2,
            "shift" => 3,
            "cmd" | "command" | "meta" | "win" | "super" => 4,
            other => return Err(format!("Modificador inválido: {}", other)),
        },
    };

    if mode == 0 {
        DOUBLE_TAP_MODE.store(0, Ordering::SeqCst);
        return Ok(());
    }

    // Ativando double-tap: desliga combo pra não disparar duplo.
    let _ = app.global_shortcut().unregister_all();
    LAST_PRESS_MS.store(-1, Ordering::SeqCst);
    DOUBLE_TAP_MODE.store(mode, Ordering::SeqCst);
    Ok(())
}

#[cfg(not(desktop))]
#[tauri::command]
fn set_capture_double_tap(
    _app: tauri::AppHandle,
    _modifier: Option<String>,
) -> Result<(), String> {
    Err("Atalho global não suportado nesta plataforma".to_string())
}

// ---------------------------------------------------------------------------
// Detector de dupla pressão — polling em thread separada
// ---------------------------------------------------------------------------

// CoreGraphics: query síncrona ao estado físico dos modificadores. Não
// captura eventos (não exige Accessibility), só lê o flag register atual.
// O wrapper `core-graphics` 0.24 não expõe `flags_state` ainda, então
// declaramos a função do framework direto via FFI — é estável desde
// macOS 10.4 e amplamente documentada.
#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceFlagsState(state_id: u32) -> u64;
}

#[cfg(target_os = "macos")]
fn modifier_pressed(mode: u8) -> bool {
    // kCGEventSourceStateHIDSystemState = 1
    const HID_SYSTEM_STATE: u32 = 1;
    // Bitmasks oficiais (CGEventFlags em <CoreGraphics/CGEventTypes.h>)
    const FLAG_CONTROL: u64 = 0x040000;
    const FLAG_ALTERNATE: u64 = 0x080000; // Option
    const FLAG_SHIFT: u64 = 0x020000;
    const FLAG_COMMAND: u64 = 0x100000;

    let flags = unsafe { CGEventSourceFlagsState(HID_SYSTEM_STATE) };
    let mask = match mode {
        1 => FLAG_CONTROL,
        2 => FLAG_ALTERNATE,
        3 => FLAG_SHIFT,
        4 => FLAG_COMMAND,
        _ => return false,
    };
    flags & mask != 0
}

#[cfg(target_os = "windows")]
fn modifier_pressed(mode: u8) -> bool {
    use winapi::um::winuser::{
        GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };
    let key = match mode {
        1 => VK_CONTROL,
        2 => VK_MENU, // Alt
        3 => VK_SHIFT,
        4 => VK_LWIN, // checa LWin; cobrimos RWin abaixo
        _ => return false,
    };
    let down = unsafe { (GetAsyncKeyState(key as i32) as u16 & 0x8000) != 0 };
    if mode == 4 && !down {
        let r = unsafe { (GetAsyncKeyState(VK_RWIN as i32) as u16 & 0x8000) != 0 };
        return r;
    }
    down
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn modifier_pressed(_mode: u8) -> bool {
    // Linux: não suportado por enquanto. Polling de modifier global em X11/Wayland
    // exige bibliotecas específicas (XKB/libinput) que ainda não integramos.
    false
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// Handle salvo no setup pra que a thread de polling possa mostrar a janela.
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

fn spawn_double_tap_watcher() {
    std::thread::spawn(|| {
        let mut was_pressed = false;
        loop {
            std::thread::sleep(POLL_INTERVAL);
            let mode = DOUBLE_TAP_MODE.load(Ordering::Relaxed);
            if mode == 0 {
                was_pressed = false;
                continue;
            }
            let is_pressed = modifier_pressed(mode);
            // Detecta APENAS a transição "estava solto → ficou pressionado".
            // Auto-repeat do SO não afeta porque continuamos olhando state
            // físico, não eventos KeyPress.
            if is_pressed && !was_pressed {
                let now = now_ms();
                let last = LAST_PRESS_MS.load(Ordering::Relaxed);
                if last >= 0 && (now - last) < DOUBLE_PRESS_WINDOW_MS {
                    // Dupla pressão! Mostra a captura.
                    LAST_PRESS_MS.store(-1, Ordering::SeqCst);
                    if let Some(app) = APP_HANDLE.get() {
                        let app2 = app.clone();
                        let _ = app.run_on_main_thread(move || {
                            show_capture_window(&app2);
                        });
                    }
                } else {
                    LAST_PRESS_MS.store(now, Ordering::SeqCst);
                }
            }
            was_pressed = is_pressed;
        }
    });
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
            set_capture_double_tap,
        ]);

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
            // Guarda o handle pra thread de polling poder mostrar janelas.
            let _ = APP_HANDLE.set(app.handle().clone());
            // Watcher de double-tap roda o tempo todo. Quando mode=0, é
            // basicamente um sleep loop (sem custo de leitura do estado).
            spawn_double_tap_watcher();

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
