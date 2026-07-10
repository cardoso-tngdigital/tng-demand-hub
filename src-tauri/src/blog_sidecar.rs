// =============================================================================
// blog_sidecar.rs — spawn/kill do sidecar do TNG Blog (Bun compiled binary)
// =============================================================================
// Sobre lazy quando o usuário clica em "Blog" pela primeira vez na sessão
// (invoke `blog_sidecar_start_lazy` do React). Fica rodando até o app fechar
// — o `Drop` do `CommandChild` e o handler de shutdown do main matam o processo.
//
// Credenciais são passadas via env: SUPABASE_URL + SUPABASE_ANON_KEY vêm do
// React (mesmo bundle Vite), SUPABASE_SERVICE_ROLE_KEY é lido do env do
// processo Tauri (não trafega pelo React — é segredo do sidecar).
//
// NODE_PATH é setado apontando pra `sidecar-vendor/node_modules` empacotado
// pelo Tauri como resource — assim o sharp resolve em runtime dentro do
// binário standalone.
// =============================================================================

use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use tokio::sync::oneshot;
use tokio::time::timeout;

/// Estado global do sidecar. `None` = não subiu ainda; `Some(child)` = rodando.
pub struct BlogSidecarState {
    pub child: Mutex<Option<CommandChild>>,
    pub port: Mutex<u16>,
}

impl BlogSidecarState {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            port: Mutex::new(8000),
        }
    }
}

/// Parâmetros do start vindos do React (URL + anon key do Supabase).
#[derive(serde::Deserialize)]
pub struct StartArgs {
    pub supabase_url: String,
    pub supabase_anon_key: String,
    /// Port desejada; default 8000 (fallback pra 8001..8010 se ocupada).
    #[serde(default)]
    pub port: Option<u16>,
}

/// Retorno reportado ao React.
#[derive(serde::Serialize)]
pub struct SidecarStatus {
    pub running: bool,
    pub port: u16,
}

/// Sobe o sidecar se ainda não subiu. Idempotente: se já rodando, devolve
/// `running: true` sem spawn novo.
///
/// Nota: se o state.child == Some mas o processo real está morto (crash,
/// kill externo), fazemos um health-check contra a porta atual e limpamos
/// o zombie antes de tentar respawnar. Isso evita o cenário "kill externo →
/// front bate em endpoint fantasma para sempre".
#[tauri::command]
pub async fn blog_sidecar_start_lazy(
    app: AppHandle,
    state: tauri::State<'_, BlogSidecarState>,
    args: StartArgs,
) -> Result<SidecarStatus, String> {
    // Já subiu?
    let porta_atual: Option<u16> = {
        let child_lock = state.child.lock().map_err(|e| e.to_string())?;
        if child_lock.is_some() {
            let port = *state.port.lock().map_err(|e| e.to_string())?;
            Some(port)
        } else {
            None
        }
    };
    if let Some(port) = porta_atual {
        if _porta_esta_viva(port).await {
            return Ok(SidecarStatus { running: true, port });
        }
        // Child registrado, mas nada escuta na porta — child virou zombie
        // (crash silencioso, kill externo, term event não chegou a tempo).
        // Limpa e cai no spawn abaixo.
        eprintln!(
            "[blog-sidecar] child registrado como vivo, mas porta {port} não responde. Limpando e respawnando.",
        );
        if let Ok(mut child_lock) = state.child.lock() {
            if let Some(child) = child_lock.take() {
                let _ = child.kill();
            }
        }
    }

    let desired_port = args.port.unwrap_or(8000);

    // NODE_PATH aponta pro sidecar-vendor empacotado como resource. Em dev
    // fica em `blog-backend/sidecar-vendor/node_modules`; em bundle fica em
    // `resources/sidecar-vendor/node_modules` dentro do app.
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Falha ao resolver resource_dir: {e}"))?;
    let node_path = resource_dir
        .join("sidecar-vendor")
        .join("node_modules")
        .to_string_lossy()
        .to_string();

    // SUPABASE_SERVICE_ROLE_KEY é opcional e vem do env do sistema (nunca
    // do React, que não deve conhecê-la). É o que liga o scheduler.
    let service_role_key =
        std::env::var("SUPABASE_SERVICE_ROLE_KEY").unwrap_or_default();

    let mut sidecar = app
        .shell()
        .sidecar("tng-blog-sidecar")
        .map_err(|e| format!("Sidecar não encontrado: {e}"))?
        .env("SUPABASE_URL", args.supabase_url)
        .env("SUPABASE_ANON_KEY", args.supabase_anon_key)
        .env("PORT", desired_port.to_string())
        .env("NODE_PATH", node_path);

    // IMPORTANTE: só injeta a chave quando ela existe no ambiente do processo.
    // Se passássemos "" (vazio), essa variável de processo SOMBREARIA o valor
    // vindo do `.env` que o binário Bun carrega do cwd — e o scheduler ficaria
    // desligado mesmo com a chave presente em `src-tauri/.env`. Deixando a
    // variável ausente, o Bun preenche a partir do `.env` (dev). Em produção,
    // a chave chega pelo env real do processo. Descoberto em 2026-07-08.
    if !service_role_key.is_empty() {
        sidecar = sidecar.env("SUPABASE_SERVICE_ROLE_KEY", service_role_key);
    }

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("Falha ao spawnar sidecar: {e}"))?;

    // Oneshot pra o handler de stdout enviar a porta efetiva assim que o
    // sidecar imprimir "rodando em http://127.0.0.1:XXXX". Se `desired_port`
    // estava ocupada, o sidecar sobe em 8001/8002... — precisamos da porta
    // real, não da desejada, senão o front bate em endpoint fantasma.
    let (tx_porta, rx_porta) = oneshot::channel::<u16>();
    let mut tx_porta_opt: Option<oneshot::Sender<u16>> = Some(tx_porta);

    // Clone do AppHandle pro handler async — precisa dele pra pegar o state
    // e limpar o child quando o sidecar terminar (evita zombie no state).
    let app_para_handler = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    if let Ok(s) = String::from_utf8(bytes) {
                        println!("[blog-sidecar] {s}");
                        // Extrai porta efetiva do log de boot.
                        if let Some(porta) = _extrair_porta(&s) {
                            if let Some(tx) = tx_porta_opt.take() {
                                let _ = tx.send(porta);
                            }
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    if let Ok(s) = String::from_utf8(bytes) {
                        eprintln!("[blog-sidecar] {s}");
                    }
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[blog-sidecar] terminou: {:?}", payload.code);
                    // Limpa o child do state pra próxima abertura do painel
                    // Blog spawnar um novo em vez de reportar "rodando" fantasma.
                    // Escopo isolado + semicolon final pra o State<'_> ser
                    // dropped antes do temporário Result do `.lock()`.
                    let state: tauri::State<'_, BlogSidecarState> =
                        app_para_handler.state();
                    let mut child_lock = match state.child.lock() {
                        Ok(g) => g,
                        Err(_) => continue,
                    };
                    *child_lock = None;
                    drop(child_lock);
                    drop(state);
                }
                _ => {}
            }
        }
    });

    // Salva o child no estado. A porta será atualizada assim que soubermos.
    {
        let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;
        *child_lock = Some(child);
        let mut port_lock = state.port.lock().map_err(|e| e.to_string())?;
        *port_lock = desired_port;
    }

    // Espera até 8s pelo log "rodando em http://127.0.0.1:X". Bun compile
    // costuma subir em <2s; damos margem pra máquinas lentas. Se estourar,
    // devolvemos a porta desejada como best-effort (o front vai perceber a
    // falha nas próximas chamadas de fetch).
    let porta_efetiva = match timeout(Duration::from_secs(8), rx_porta).await {
        Ok(Ok(porta)) => {
            let mut port_lock = state.port.lock().map_err(|e| e.to_string())?;
            *port_lock = porta;
            porta
        }
        _ => desired_port,
    };

    Ok(SidecarStatus {
        running: true,
        port: porta_efetiva,
    })
}

/**
 * Health-check TCP simples: tenta conectar em 127.0.0.1:port com timeout de
 * 500ms. Sucesso = alguém escuta (sidecar vivo). Falha = porta livre ou
 * o processo morreu (zombie no state). Não fazemos HTTP porque é overkill
 * pra saber se o processo está bindado — TCP connect basta e é mais rápido.
 */
async fn _porta_esta_viva(port: u16) -> bool {
    use std::net::SocketAddr;
    use tokio::net::TcpStream;
    let addr: SocketAddr = match format!("127.0.0.1:{port}").parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    matches!(
        timeout(Duration::from_millis(500), TcpStream::connect(addr)).await,
        Ok(Ok(_))
    )
}

/**
 * Extrai a porta do log de boot: "rodando em http://127.0.0.1:39905".
 * Devolve `None` se o log não bate no padrão.
 */
fn _extrair_porta(linha: &str) -> Option<u16> {
    let marca = "127.0.0.1:";
    let idx = linha.find(marca)?;
    let rest = &linha[idx + marca.len()..];
    let num: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    num.parse().ok()
}

/// Retorna se o sidecar está rodando + porta.
#[tauri::command]
pub fn blog_sidecar_status(
    state: tauri::State<'_, BlogSidecarState>,
) -> SidecarStatus {
    let running = state
        .child
        .lock()
        .map(|c| c.is_some())
        .unwrap_or(false);
    let port = state.port.lock().map(|p| *p).unwrap_or(8000);
    SidecarStatus { running, port }
}

/// Mata o sidecar. Chamado no shutdown pra não deixar processo zombie.
pub fn kill_sidecar(state: &BlogSidecarState) {
    if let Ok(mut child_lock) = state.child.lock() {
        if let Some(child) = child_lock.take() {
            let _ = child.kill();
        }
    }
}
