// =============================================================================
// Tipos do banco de dados — TNG Demand Hub
// =============================================================================
// Espelham as tabelas do PostgreSQL no Supabase. Atualize sempre que rodar
// uma nova migração.
// =============================================================================

export type DemandStatus = "todo" | "doing" | "done" | "archived";
export type DemandPriority = "baixa" | "media" | "alta" | "urgente";
export type DemandInfrastructure = "wordpress" | "site_ia";
export type CapturedVia = "hotkey" | "tray" | "manual";
export type UserRole = "admin" | "member";
export type ClientStatus = "active" | "inactive";

export interface NotificationPrefs {
  assigned: boolean;
  due_soon: boolean;
  comments: boolean;
  completed: boolean;
  // Menções (@usuario) em comentários. Quando ausente em registros antigos,
  // tratamos como true (default) — código consumidor usa nullish coalescing.
  mentions?: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  assigned: true,
  due_soon: true,
  comments: true,
  completed: true,
  mentions: true,
};

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  area: string | null;
  hotkey: string;
  theme: "light" | "dark" | "system";
  active: boolean;
  notifications: NotificationPrefs;
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
  google_business_url: string | null;
  drive_urls: string[];
  whatsapp_group_url: string | null;
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
  infrastructure: DemandInfrastructure | null;
  ai_confidence: Record<string, number> | null;
  ai_raw_response: unknown | null;
  ai_cost_micro: number | null;
  captured_via: CapturedVia;
  comments_count: number;
  attachments_count: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // Setado pelo trigger BEFORE UPDATE (auth.uid()). Fica null no insert
  // inicial — o autor da criação é o created_by. Usado pelas notificações
  // pra mostrar "Fulano alterou X".
  updated_by: string | null;
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
  infrastructure?: DemandInfrastructure | null;
  captured_via?: CapturedVia;
}

export type DemandHistoryEvent =
  | "created"
  | "field_changed"
  | "comment_added"
  | "comment_deleted"
  | "attachment_added";

export interface DemandHistoryRow {
  id: string;
  demand_id: string;
  event_type: DemandHistoryEvent;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  actor_id: string | null;
  created_at: string;
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

export interface Comment {
  id: string;
  demand_id: string;
  author_id: string;
  content: string;
  mentions: string[];
  created_at: string;
  updated_at: string;
}

export type RuleMatchField = "description" | "client" | "tag";
export type RuleMatchOperator = "contains" | "equals";
export type RuleSetField = "assignee_id" | "priority" | "tag";

export interface ClassificationRule {
  id: string;
  name: string;
  match_field: RuleMatchField;
  match_operator: RuleMatchOperator;
  match_value: string;
  set_field: RuleSetField;
  set_value: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
