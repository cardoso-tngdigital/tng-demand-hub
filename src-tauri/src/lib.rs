// =============================================================================
// TNG Sites - Demandas — Tauri Core
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

use std::sync::atomic::{AtomicI32, AtomicI64, AtomicU8, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
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

// PID do app que estava em foreground antes de a captura aparecer.
// Guardamos imediatamente antes de show() pra poder reativar
// manualmente esse app quando a captura for destruída. Sem isso, o
// macOS escolhe a próxima janela do mesmo app (a main) — o tipo de
// focus-stealing que o user descreveu como "a janela principal abre
// sem eu pedir".
//
// Tentamos antes (2026-06-27/29):
//   - `NSApp.hide(nil)` → escondia TODAS as janelas; quando reativa o
//     app pra mostrar a captura nova, restaura a main junto.
//   - `NSApp.deactivate()` → não basta; o macOS ainda promove a main
//     do TNG em vez de transferir o foco pra outro app.
//
// A solução que funciona é dizer explicitamente *qual* app deve voltar.
#[cfg(target_os = "macos")]
static PREVIOUS_APP_PID: AtomicI32 = AtomicI32::new(-1);

#[cfg(target_os = "macos")]
fn remember_frontmost_app_pid() {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};
    unsafe {
        let workspace: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        if workspace.is_null() {
            return;
        }
        let frontmost: *mut Object = msg_send![workspace, frontmostApplication];
        if frontmost.is_null() {
            return;
        }
        let pid: i32 = msg_send![frontmost, processIdentifier];
        let our_pid = std::process::id() as i32;
        if pid > 0 && pid != our_pid {
            PREVIOUS_APP_PID.store(pid, Ordering::SeqCst);
        }
    }
}

#[cfg(target_os = "macos")]
fn activate_previous_app() {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};
    let pid = PREVIOUS_APP_PID.load(Ordering::SeqCst);
    if pid <= 0 {
        return;
    }
    unsafe {
        let app: *mut Object = msg_send![
            class!(NSRunningApplication),
            runningApplicationWithProcessIdentifier: pid
        ];
        if app.is_null() {
            return;
        }
        // NSApplicationActivateIgnoringOtherApps = 1 << 1 = 2
        let _: bool = msg_send![app, activateWithOptions: 2u64];
    }
    PREVIOUS_APP_PID.store(-1, Ordering::SeqCst);
}

// Destrói a janela `capture` em vez de só esconder. Como ela é criada
// on-demand (Sprint 18), destruir é o que limpa o `CGWindowList` do macOS
// e impede o AltTab de listar a janela como aberta. Próxima invocação do
// atalho global chama `ensure_capture_window` que recria.
//
// No macOS, ANTES de destruir, devolvemos o foco ao app que estava em
// foreground quando a captura abriu (guardado em PREVIOUS_APP_PID). Sem
// isso o macOS escolheria a main do TNG pra promover. No Windows não
// há focus stealing, então só o destroy basta.
//
// Nome `hide_capture_window` mantido pra não quebrar os call sites do JS
// — a semântica observável (a janela some) é a mesma.
#[tauri::command]
fn hide_capture_window(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.run_on_main_thread(|| {
            activate_previous_app();
        });
    }
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.destroy();
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
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    // Registra com handler específico pra ESTE shortcut. Outros atalhos
    // registrados pelo JS (ex: Esc da janela preview) têm seus próprios
    // callbacks e não disparam esse aqui.
    gs.on_shortcut(accelerator.as_str(), |app, _shortcut, event| {
        if event.state() == ShortcutState::Pressed {
            show_capture_window(app);
        }
    })
    .map_err(|e| e.to_string())?;
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
//
// As janelas `capture` e `preview` são criadas on-demand via Rust em vez
// de declaradas em `tauri.conf.json`. Motivo: no macOS, janelas vivas
// porém invisíveis ainda aparecem no `CGWindowList`, então apps de
// terceiros como AltTab as listam como abertas mesmo escondidas. Criar
// on-demand + `destroy()` no fechamento elimina esse vazamento. Custo:
// ~200ms de cold start no primeiro disparo após o boot — aceitável.

fn ensure_capture_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(window) = app.get_webview_window("capture") {
        return Some(window);
    }
    match WebviewWindowBuilder::new(
        app,
        "capture",
        WebviewUrl::App("index.html#capture".into()),
    )
    .title("Captura rápida")
    .inner_size(640.0, 420.0)
    .center()
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(true)
    .minimizable(false)
    .maximizable(false)
    .visible(false)
    .focused(false)
    .build()
    {
        Ok(window) => Some(window),
        Err(err) => {
            eprintln!("[ensure_capture_window] erro ao criar: {}", err);
            None
        }
    }
}

fn ensure_preview_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(window) = app.get_webview_window("preview") {
        return Some(window);
    }
    match WebviewWindowBuilder::new(
        app,
        "preview",
        WebviewUrl::App("index.html#preview".into()),
    )
    .title("Pré-visualização")
    .inner_size(1000.0, 720.0)
    .min_inner_size(480.0, 360.0)
    .center()
    .shadow(true)
    .visible(false)
    .focused(false)
    .build()
    {
        Ok(window) => Some(window),
        Err(err) => {
            eprintln!("[ensure_preview_window] erro ao criar: {}", err);
            None
        }
    }
}

fn show_capture_window(app: &tauri::AppHandle) {
    // Guarda o app que está no foreground AGORA, antes da captura tomar
    // o foco. `hide_capture_window` usa isso pra devolver o foco ao app
    // correto quando o user cancelar/concluir a captura.
    #[cfg(target_os = "macos")]
    remember_frontmost_app_pid();

    if let Some(window) = ensure_capture_window(app) {
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

// Commands invocáveis do frontend pra forçar a criação on-demand das
// janelas auxiliares antes de emitir eventos pra elas (sem isso, o
// evento se perde porque a janela ainda não existe).
#[tauri::command]
fn ensure_capture_window_cmd(app: tauri::AppHandle) {
    let _ = ensure_capture_window(&app);
}

#[tauri::command]
fn ensure_preview_window_cmd(app: tauri::AppHandle) {
    let _ = ensure_preview_window(&app);
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
            ensure_capture_window_cmd,
            ensure_preview_window_cmd,
        ]);

    // Single-instance: garante que clicar no atalho da taskbar/Dock
    // reativa a instância existente em vez de abrir outra. Sem isso,
    // o usuário acaba com 2-3 ícones na bandeja do Windows quando
    // pensa que fechou o app e clica no atalho de novo.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(
            |app, _args, _cwd| {
                show_main_window(app);
            },
        ));
    }

    #[cfg(desktop)]
    {
        // Sem `with_handler` global: handlers são registrados por shortcut via
        // `on_shortcut` dentro de `set_capture_hotkey`. O handler global era
        // disparado por QUALQUER shortcut, então outros atalhos registrados
        // (ex: Esc da janela preview) também abriam a captura.
        builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
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
            let abrir_item = MenuItem::with_id(app, "open", "Abrir TNG Sites - Demandas", true, None::<&str>)?;
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
                // template(false) = mantém as cores do logo no menubar.
                // Com template(true) o macOS converte o icon pra silhueta
                // monocromática usando só o canal alfa — e como o nosso
                // logo tem fundo preenchido, sai como um quadrado branco.
                .icon_as_template(false)
                .tooltip("TNG Sites - Demandas")
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

            // Intercepta o X da janela main: esconde em vez de fechar.
            // Combinado com o tray icon (Abrir / Sair) e com single-instance,
            // garante que o app continua rodando em segundo plano e o
            // usuário sempre consegue reativá-lo pelo tray ou pelo atalho
            // da taskbar/Dock — em vez de spawnar nova instância.
            if let Some(main_window) = app.get_webview_window("main") {
                let main_clone = main_window.clone();
                main_window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = main_clone.hide();
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
