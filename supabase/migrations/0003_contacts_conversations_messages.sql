-- ---------------------------------------------------------------------------
-- contacts: a pessoa do outro lado da conversa, identificada pelo handle
-- do canal (telefone, e-mail, @user, ...).
-- ---------------------------------------------------------------------------
create table public.contacts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  channel_type  text not null,
  handle        text not null,
  display_name  text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  -- mesmo handle no mesmo canal não deve virar dois contatos distintos
  -- dentro do mesmo tenant.
  unique (tenant_id, channel_type, handle)
);

create index contacts_tenant_id_idx on public.contacts (tenant_id);

alter table public.contacts enable row level security;

create policy "contacts_isolation"
  on public.contacts for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------------
-- conversations: thread entre um contact e uma channel_connection.
-- ---------------------------------------------------------------------------
create table public.conversations (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants (id) on delete cascade,
  contact_id            uuid not null references public.contacts (id) on delete cascade,
  channel_connection_id uuid not null references public.channel_connections (id) on delete cascade,
  status                text not null default 'open' check (status in ('open', 'pending', 'resolved')),
  last_message_at       timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index conversations_tenant_id_idx on public.conversations (tenant_id);
create index conversations_tenant_status_idx on public.conversations (tenant_id, status, last_message_at desc);
create index conversations_contact_id_idx on public.conversations (contact_id);

alter table public.conversations enable row level security;

create policy "conversations_isolation"
  on public.conversations for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------------
-- messages: unidade normalizada de mensagem, agnóstica de canal.
--
-- `channel_message_id` + a constraint unique abaixo são a base da
-- idempotência: reprocessar o mesmo webhook (retry do provedor) não duplica
-- a mensagem.
-- ---------------------------------------------------------------------------
create table public.messages (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants (id) on delete cascade,
  conversation_id       uuid not null references public.conversations (id) on delete cascade,
  channel_connection_id uuid not null references public.channel_connections (id) on delete cascade,
  direction             text not null check (direction in ('inbound', 'outbound')),
  content               jsonb not null,
  channel_message_id    text,
  status                text not null default 'received' check (
    status in ('received', 'queued', 'sent', 'delivered', 'failed')
  ),
  created_at            timestamptz not null default now(),
  unique (tenant_id, channel_connection_id, channel_message_id)
);

create index messages_tenant_id_idx on public.messages (tenant_id);
create index messages_conversation_id_idx on public.messages (conversation_id, created_at);

alter table public.messages enable row level security;

create policy "messages_isolation"
  on public.messages for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
