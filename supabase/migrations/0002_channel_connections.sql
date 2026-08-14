-- ---------------------------------------------------------------------------
-- channel_connections: uma conta de canal conectada por um tenant
-- (um número de WhatsApp, uma caixa de e-mail, etc.).
--
-- `credentials_encrypted` guarda o resultado de core/crypto.ts (AES-256-GCM):
-- nunca token/segredo em texto claro no banco.
-- ---------------------------------------------------------------------------
create table public.channel_connections (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants (id) on delete cascade,
  channel_type           text not null,
  display_name           text not null,
  status                 text not null default 'active' check (status in ('active', 'disabled', 'error')),
  credentials_encrypted  text not null,
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index channel_connections_tenant_id_idx on public.channel_connections (tenant_id);
create index channel_connections_channel_type_idx on public.channel_connections (tenant_id, channel_type);

alter table public.channel_connections enable row level security;

create policy "channel_connections_isolation"
  on public.channel_connections for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
