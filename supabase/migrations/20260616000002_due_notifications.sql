-- =============================================================================
-- TNG Demand Hub — Notificações de prazo (Sprint 14)
-- =============================================================================
-- Antes desta Sprint o app só notificava eventos realtime (atribuição,
-- comentário, mudança). Agora notifica também demandas próximas do prazo
-- em 3 janelas: 5 dias, 3 dias e 24h antes.
--
-- Arquitetura:
--   - Função SQL `compute_due_notifications()` decide quem notificar.
--   - Tabela `demand_due_notifications` tem PK composta (demand_id, user_id,
--     bucket) que naturalmente deduplica via ON CONFLICT DO NOTHING.
--   - pg_cron roda a função 1x/dia. Insert dispara realtime, cliente escuta
--     e mostra notificação local.
-- =============================================================================

create table public.demand_due_notifications (
  demand_id uuid not null references public.demands(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  bucket text not null check (bucket in ('5d','3d','24h')),
  sent_at timestamptz not null default now(),
  primary key (demand_id, user_id, bucket)
);

comment on table public.demand_due_notifications is
  'Registro de notificações de prazo já enviadas. PK composta deduplica idempotentemente.';

create index demand_due_notifications_user_idx
  on public.demand_due_notifications (user_id, sent_at desc);

alter table public.demand_due_notifications enable row level security;

-- Cada user só lê os próprios registros. Inserts só via security definer
-- (a função abaixo) — nenhuma policy de insert pra authenticated.
create policy "due_notif_select_own"
  on public.demand_due_notifications for select
  to authenticated
  using (user_id = auth.uid());

alter publication supabase_realtime add table public.demand_due_notifications;

-- -----------------------------------------------------------------------------
-- Função que materializa os registros novos
-- -----------------------------------------------------------------------------
-- Idempotente — pode rodar várias vezes ao dia sem duplicar (PK composta
-- garante). Respeita `profiles.notifications->>'due_soon'`: se o user
-- desligou esse tipo, não recebe.
create or replace function public.compute_due_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 5 dias antes do vencimento. Janela exata: due_date = hoje + 5 dias.
  insert into demand_due_notifications (demand_id, user_id, bucket)
  select d.id, d.assignee_id, '5d'
  from demands d
  join profiles p on p.id = d.assignee_id
  where d.due_date is not null
    and d.assignee_id is not null
    and d.status in ('todo','doing')
    and d.due_date = (current_date + interval '5 days')::date
    and coalesce((p.notifications->>'due_soon')::boolean, true) = true
  on conflict do nothing;

  -- 3 dias antes
  insert into demand_due_notifications (demand_id, user_id, bucket)
  select d.id, d.assignee_id, '3d'
  from demands d
  join profiles p on p.id = d.assignee_id
  where d.due_date is not null
    and d.assignee_id is not null
    and d.status in ('todo','doing')
    and d.due_date = (current_date + interval '3 days')::date
    and coalesce((p.notifications->>'due_soon')::boolean, true) = true
  on conflict do nothing;

  -- 24h: due_date = amanhã
  insert into demand_due_notifications (demand_id, user_id, bucket)
  select d.id, d.assignee_id, '24h'
  from demands d
  join profiles p on p.id = d.assignee_id
  where d.due_date is not null
    and d.assignee_id is not null
    and d.status in ('todo','doing')
    and d.due_date = (current_date + interval '1 day')::date
    and coalesce((p.notifications->>'due_soon')::boolean, true) = true
  on conflict do nothing;
end;
$$;

-- -----------------------------------------------------------------------------
-- Agendamento via pg_cron
-- -----------------------------------------------------------------------------
-- pg_cron precisa estar habilitado no projeto (Dashboard → Database →
-- Extensions). Em projetos free do Supabase pode não estar disponível;
-- o admin pode chamar compute_due_notifications() manualmente, ou habilitar
-- a extensão pelo dashboard quando upgrade pra paid.
--
-- Cron roda em UTC. 09:00 UTC = 06:00 São Paulo (UTC-3) — antes do
-- expediente, pra que o user encontre as notificações ao começar o dia.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Remove agendamento anterior (idempotente em re-run da migration)
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'tng-compute-due-notifications-daily';

    perform cron.schedule(
      'tng-compute-due-notifications-daily',
      '0 9 * * *',
      'select public.compute_due_notifications();'
    );
  else
    raise notice 'pg_cron não habilitado. Habilite em Dashboard → Database → Extensions ou rode compute_due_notifications() manualmente.';
  end if;
end$$;
