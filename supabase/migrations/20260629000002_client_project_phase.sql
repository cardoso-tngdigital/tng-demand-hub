-- Sprint 20 (v0.1.11): novo campo `project_phase` em clients pra rastrear
-- o estado global do projeto do cliente (não iniciado / em desenvolvimento /
-- desenvolvido). Renderizado como badge nos cards do novo painel "Por
-- cliente" e editável via select inline no drawer do cliente.

alter table public.clients
  add column project_phase text not null default 'not_started'
  check (project_phase in ('not_started', 'in_development', 'developed'));

comment on column public.clients.project_phase is
  'Fase global do projeto do cliente: not_started | in_development | developed.';
