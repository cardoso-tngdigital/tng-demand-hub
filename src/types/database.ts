// =============================================================================
// Tipos do banco de dados — TNG Demand Hub
// =============================================================================
// Espelham as tabelas do PostgreSQL no Supabase. Atualize sempre que rodar
// uma nova migração.
// =============================================================================

export type DemandStatus = "todo" | "doing" | "done" | "archived";
export type DemandPriority = "baixa" | "media" | "alta" | "urgente";
export type CapturedVia = "hotkey" | "tray" | "manual";
export type UserRole = "admin" | "member";
export type ClientStatus = "active" | "inactive";

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  area: string | null;
  hotkey: string;
  theme: "light" | "dark" | "system";
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  name: string;
  alias: string | null;
  email: string | null;
  phone: string | null;
  status: ClientStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Demand {
  id: string;
  title: string;
  description: string;
  client_id: string | null;
  assignee_id: string | null;
  created_by: string;
  priority: DemandPriority;
  status: DemandStatus;
  due_date: string | null;
  tags: string[];
  ai_confidence: Record<string, number> | null;
  ai_raw_response: unknown | null;
  ai_cost_micro: number | null;
  captured_via: CapturedVia;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewDemandInput {
  description: string;
  title?: string;
  client_id?: string | null;
  assignee_id?: string | null;
  priority?: DemandPriority;
  status?: DemandStatus;
  due_date?: string | null;
  tags?: string[];
  captured_via?: CapturedVia;
}

export interface Attachment {
  id: string;
  demand_id: string;
  file_path: string;
  file_name: string;
  file_type: string;
  file_size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
}
