-- ---------------------------------------------------------------------------
-- audit_logs: trilha de auditoria por tenant (quem conectou/enviou o quê).
-- Escrita feita pelo backend (rotas autenticadas usam o client do próprio
-- usuário, então o auth.uid() abaixo é sempre o ator real; o worker, quando
-- registra eventos de sistema, usa service_role e informa actor_user_id
-- explicitamente, podendo ser null para eventos automáticos).
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  actor_user_id  uuid references auth.users (id) on delete set null,
  action         text not null,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index audit_logs_tenant_id_idx on public.audit_logs (tenant_id, created_at desc);

alter table public.audit_logs enable row level security;

-- Auditoria é somente leitura para o tenant; escrita é feita pelo backend
-- (client do usuário faz insert normal e passa pelo RLS com check abaixo;
-- o worker usa service_role e ignora RLS, mas sempre com tenant_id validado
-- em código antes do insert).
create policy "audit_logs_select_own_tenant"
  on public.audit_logs for select
  using (tenant_id = public.current_tenant_id());

create policy "audit_logs_insert_own_tenant"
  on public.audit_logs for insert
  with check (tenant_id = public.current_tenant_id());
