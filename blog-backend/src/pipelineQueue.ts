/**
 * pipelineQueue.ts — fila SERIAL global de execução de pipelines (2026-07-09).
 *
 * Decisão de produto: nunca rodar mais de UM artigo por vez. Publicar vários
 * "ao mesmo tempo" (2 pipelines simultâneos + polling) foi o que saturou o
 * sidecar e travou o app. Em vez de disparar tudo em paralelo, enfileiramos:
 * cada pipeline roda o fluxo completo e só quando ele termina o próximo começa.
 *
 * Um único worker consome a fila em FIFO. TODA execução de pipeline — modo
 * "agora" (routes/artigos.ts) E o scheduler (scheduler.ts) — passa por aqui,
 * então os dois caminhos compartilham a mesma fila e jamais colidem.
 */

/** Item da fila: a tarefa em si + callback opcional disparado quando ela SAI
 *  da fila e começa a rodar (usado pra flipar o estado do job de "na_fila"
 *  pra "iniciando" na UI). */
interface ItemFila {
  tarefa: () => Promise<void>;
  onStart?: () => void;
}

const fila: ItemFila[] = [];
let processando = false;

/** Quantos itens estão aguardando/rodando (inclui o que está em execução). */
export function tamanhoFila(): number {
  return fila.length + (processando ? 1 : 0);
}

/** `true` se há algo rodando ou esperando. */
export function estaOcupado(): boolean {
  return processando || fila.length > 0;
}

/**
 * Enfileira uma tarefa "fire-and-forget" (o chamador não espera o resultado —
 * usado pelo modo "agora", que reporta progresso via o Map de JOBS). `onStart`
 * roda no instante em que a tarefa é escolhida da fila.
 */
export function enfileirar(
  tarefa: () => Promise<void>,
  onStart?: () => void,
): void {
  fila.push({ tarefa, onStart });
  void _drenar();
}

/**
 * Enfileira uma tarefa e devolve uma Promise que resolve/rejeita com o
 * resultado dela — usado pelo scheduler, que precisa do resultado do pipeline
 * pra atualizar o status do agendamento.
 */
export function enfileirarComResultado<T>(
  fn: () => Promise<T>,
  onStart?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    enfileirar(async () => {
      try {
        resolve(await fn());
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }, onStart);
  });
}

/** Consome a fila, um item por vez. Reentrância protegida por `processando`. */
async function _drenar(): Promise<void> {
  if (processando) return;
  processando = true;
  try {
    while (fila.length > 0) {
      const item = fila.shift() as ItemFila;
      try {
        item.onStart?.();
      } catch {
        // onStart é só UI — nunca deve derrubar o worker.
      }
      try {
        await item.tarefa();
      } catch {
        // A tarefa é responsável por tratar/registrar o próprio erro. O worker
        // segue pro próximo item mesmo se uma tarefa lançar.
      }
    }
  } finally {
    processando = false;
  }
}
