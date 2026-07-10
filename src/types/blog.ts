// =============================================================================
// Tipos compartilhados do painel Blog — Sprint 27
// =============================================================================
// Espelha o shape dos payloads retornados pelo sidecar Node em
// `blog-backend/` (Sprints 21-26). Nenhum destes tipos toca o banco do
// TNG Demand Hub principal — o Blog vive num schema Supabase separado
// (`blog.*`).
// =============================================================================

export type BlogSite = {
  id: string;
  nome: string | null;
  url: string;
  prompt: string | null;
  responsavel: string | null;
  plugin: boolean;
  rankmath: boolean;
  status: "conectado" | "erro" | string;
  ultima_verificacao: string | null;
  created_at: string;
};

export type BlogHistoricoItem = {
  id: string;
  site_id: string;
  keyword: string;
  title: string;
  slug: string;
  post_url: string;
  status: "concluido" | "rascunho" | "falhou" | string;
  data_publicacao: string;
  imagens: number;
  links_internos: unknown;
  created_at: string;
};

export type BlogAgendamento = {
  id: string;
  site_id: string;
  keyword: string;
  data_programada: string;
  rascunho: boolean;
  status: "pendente" | "executando" | "concluido" | "falhou" | string;
  post_url: string | null;
  erro: string | null;
  created_at: string;
};

export type BlogProgresso = {
  etapa:
    | "na_fila"
    | "iniciando"
    | "links"
    | "texto"
    | "imagens"
    | "publicando"
    | "historico"
    | "concluido"
    | "falhou";
  mensagem: string;
};

export type BlogJob = {
  job_id: string;
  keyword: string;
  site_id: string;
  progresso: BlogProgresso;
  resultado?: {
    status: "concluido" | "rascunho" | "falhou";
    post_url?: string;
    slug?: string;
    erro?: string;
  };
  concluido_em?: number;
};

export type BlogNotificacaoTipo = "info" | "success" | "warning" | "error";

export type BlogNotificacao = {
  id: string;
  user_id: string;
  site_id: string | null;
  job_id: string | null;
  agendamento_id: string | null;
  tipo: BlogNotificacaoTipo;
  titulo: string;
  mensagem: string;
  contexto: Record<string, unknown> | null;
  lida: boolean;
  created_at: string;
};
