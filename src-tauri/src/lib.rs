// =============================================================================
// TNG Sites — Demandas — Tauri Core
// =============================================================================
// Responsabilidades:
// - Inicializar plugins (opener, notification, updater, process, dialog).
// - Hook global de teclado via rdev para detectar dupla pressão de tecla
//   modificadora (ctrl+ctrl, alt+alt, shift+shift ou cmd+cmd) em qualquer
//   janela do sistema. Substitui o tauri-plugin-global-shortcut, que só
//   aceita combinações tradicionais.
// - Comandos invocáveis do frontend: hide_capture_window, set_tray_badge,
//   read_file_bytes, set_capture_hotkey, check_accessibility_permission.
// - Tray icon na bandeja com menu (Abrir / Nova captura / Sair).
//
// Sobre dupla pressão e permissão Accessibility (macOS):
//   O macOS bloqueia leitura de teclas globais sem a permissão de
//   Accessibility. Na primeira execução o sistema mostra um popup pedindo
//   permissão. Enquanto o user não concede, o rdev escuta mas não recebe
//   eventos — é o esperado. O frontend usa check_accessibility_permission
//   pra exibir um banner de aviso quando a permissão está pendente.
// =============================================================================

use rdev::{listen, Event, EventType, Key};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

// ---------------------------------------------------------------------------
// Hotkey state — dupla pressão de modificador
// ---------------------------------------------------------------------------

// Janela máxima entre as duas pressões pra considerar dupla. 400ms é o valor
// que o Claude Desktop e o Spotlight usam — confortável pro dedo médio, não
// dispara por erro com toques perdidos espaçados.
const DOUBLE_PRESS_WINDOW: Duration = Duration::from_millis(400);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum HotkeyModifier {
    Ctrl,
    Alt,
    Shift,
    Cmd,
}

impl HotkeyModifier {
    fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "ctrl" | "control" => Some(Self::Ctrl),
            "alt" | "option" => Some(Self::Alt),
            "shift" => Some(Self::Shift),
            "cmd" | "meta" | "win" | "super" => Some(Self::Cmd),
            _ => None,
        }
    }

    fn matches(self, key: Key) -> bool {
        match (self, key) {
            (Self::Ctrl, Key::ControlLeft | Key::ControlRight) => true,
            (Self::Alt, Key::Alt | Key::AltGr) => true,
            (Self::Shift, Key::ShiftLeft | Key::ShiftRight) => true,
            (Self::Cmd, Key::MetaLeft | Key::MetaRight) => true,
            _ => false,
        }
    }
}

struct HotkeyState {
    target: HotkeyModifier,
    last_press: Option<Instant>,
    // Filtra auto-repeat do SO: se a tecla já está marcada como pressionada,
    // ignoramos os próximos KeyPress até receber KeyRelease.
    is_pressed: bool,
}

impl Default for HotkeyState {
    fn default() -> Self {
        Self {
            target: if cfg!(target_os = "macos") {
                HotkeyModifier::Ctrl
            } else {
                HotkeyModifier::Alt
            },
            last_press: None,
            is_pressed: false,
        }
    }
}

// ---------------------------------------------------------------------------
// Comandos do frontend
// ---------------------------------------------------------------------------

// Comando invocável do frontend para esconder a janela de captura
#[tauri::command]
fn hide_capture_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.hide();
    }
}

// Atualiza o "badge" do tray icon: exibe o número junto ao ícone na menubar.
// Quando count = 0, limpa o título.
#[tauri::command]
fn set_tray_badge(app: tauri::AppHandle, count: u32) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let title = if count == 0 { None } else { Some(count.to_string()) };
        let _ = tray.set_title(title.as_deref());
    }
}

// Troca o modificador alvo do detector de dupla pressão.
// Aceita "ctrl" | "alt" | "shift" | "cmd" (case-insensitive).
#[tauri::command]
fn set_capture_hotkey(
    state: tauri::State<Arc<Mutex<HotkeyState>>>,
    modifier: String,
) -> Result<(), String> {
    let target = HotkeyModifier::from_str(&modifier)
        .ok_or_else(|| format!("Modificador não suportado: {}", modifier))?;
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.target = target;
    s.last_press = None;
    s.is_pressed = false;
    Ok(())
}

// macOS: verifica permissão de Accessibility. Sem ela, rdev não recebe
// eventos. Com prompt=true, dispara o popup do sistema pedindo permissão
// (na verdade ele só pisca uma vez por sessão).
#[cfg(target_os = "macos")]
#[tauri::command]
fn check_accessibility_permission(prompt: bool) -> bool {
    use macos_accessibility_client::accessibility;
    if prompt {
        accessibility::application_is_trusted_with_prompt()
    } else {
        accessibility::application_is_trusted()
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn check_accessibility_permission(_prompt: bool) -> bool {
    // Windows/Linux não precisam de permissão extra pro hook de teclado
    true
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

// ---------------------------------------------------------------------------
// Helpers de janela
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// rdev listener — roda em thread separada
// ---------------------------------------------------------------------------

fn spawn_hotkey_listener(app: tauri::AppHandle, state: Arc<Mutex<HotkeyState>>) {
    std::thread::spawn(move || {
        let result = listen(move |event: Event| match event.event_type {
            EventType::KeyPress(key) => {
                let mut s = match state.lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                if !s.target.matches(key) {
                    // Tecla diferente do alvo cancela o "timer" — se o user
                    // apertou ctrl, depois W (Cmd+W?), depois ctrl de novo,
                    // não é dupla pressão.
                    s.last_press = None;
                    return;
                }
                if s.is_pressed {
                    return; // auto-repeat do SO
                }
                s.is_pressed = true;
                let now = Instant::now();
                if let Some(last) = s.last_press {
                    if now.duration_since(last) < DOUBLE_PRESS_WINDOW {
                        s.last_press = None;
                        drop(s);
                        let app2 = app.clone();
                        let _ = app.run_on_main_thread(move || {
                            show_capture_window(&app2);
                        });
                        return;
                    }
                }
                s.last_press = Some(now);
            }
            EventType::KeyRelease(key) => {
                let mut s = match state.lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                if s.target.matches(key) {
                    s.is_pressed = false;
                }
            }
            // Cliques/movimentos não afetam o timer — só ignorar.
            _ => {}
        });
        if let Err(err) = result {
            eprintln!("[hotkey] rdev::listen falhou: {:?}", err);
        }
    });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hotkey_state: Arc<Mutex<HotkeyState>> = Arc::new(Mutex::new(HotkeyState::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(hotkey_state.clone())
        .invoke_handler(tauri::generate_handler![
            hide_capture_window,
            set_tray_badge,
            read_file_bytes,
            set_capture_hotkey,
            check_accessibility_permission,
        ])
        .setup(move |app| {
            // -----------------------------------------------------------------
            // Hook global de teclado — roda em background o tempo todo
            // -----------------------------------------------------------------
            spawn_hotkey_listener(app.handle().clone(), hotkey_state.clone());

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
