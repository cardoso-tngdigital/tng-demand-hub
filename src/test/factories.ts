// =============================================================================
// Factories de teste — produzem objetos do domínio com defaults sensatos.
// =============================================================================
// Mantém testes legíveis: cada teste passa só os campos que importam pra ele.
// =============================================================================

import type {
  Client,
  Comment,
  Demand,
  Profile,
} from "../types/database";

export function makeDemand(over: Partial<Demand> = {}): Demand {
  return {
    id: "demand-1",
    title: "Demanda de teste",
    description: "Descrição",
    client_id: null,
    assignee_id: null,
    created_by: "user-1",
    priority: "media",
    status: "todo",
    due_date: null,
    tags: [],
    infrastructure: null,
    ai_confidence: null,
    ai_raw_response: null,
    ai_cost_micro: null,
    captured_via: "hotkey",
    comments_count: 0,
    completed_at: null,
    created_at: "2026-06-06T10:00:00Z",
    updated_at: "2026-06-06T10:00:00Z",
    ...over,
  };
}

export function makeClient(over: Partial<Client> = {}): Client {
  return {
    id: "client-1",
    name: "Cliente Teste",
    alias: null,
    email: null,
    phone: null,
    status: "active",
    notes: null,
    google_business_url: null,
    drive_urls: [],
    whatsapp_group_url: null,
    created_by: null,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    ...over,
  };
}

export function makeProfile(over: Partial<Profile> = {}): Profile {
  return {
    id: "user-1",
    full_name: "Tester",
    role: "member",
    area: null,
    hotkey: "CmdOrCtrl+Shift+D",
    theme: "dark",
    active: true,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    ...over,
  };
}

export function makeComment(over: Partial<Comment> = {}): Comment {
  return {
    id: "comment-1",
    demand_id: "demand-1",
    author_id: "user-1",
    content: "<p>comentário</p>",
    mentions: [],
    created_at: "2026-06-06T11:00:00Z",
    updated_at: "2026-06-06T11:00:00Z",
    ...over,
  };
}
