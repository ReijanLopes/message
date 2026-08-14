-- Extensões
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- tenants: a empresa cliente do SaaS. Raiz do isolamento multi-inquilino.
-- ---------------------------------------------------------------------------
create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

alter table public.tenants enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: liga um usuário do Supabase Auth (auth.users) a um tenant + papel.
-- Esta tabela é a base da função current_tenant_id() usada em todas as
-- políticas de RLS abaixo.
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  role        text not null default 'agent' check (role in ('owner', 'admin', 'agent')),
  full_name   text,
  created_at  timestamptz not null default now()
);

create index profiles_tenant_id_idx on public.profiles (tenant_id);

alter table public.profiles enable row level security;

-- Um usuário só enxerga/edita o próprio profile. Criação de profiles novos
-- é feita via service_role (fluxo de onboarding/convite), não pelo usuário.
create policy "profiles_select_own"
  on public.profiles for select
  using (user_id = auth.uid());

create policy "profiles_update_own"
  on public.profiles for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- current_tenant_id(): resolve o tenant do usuário autenticado a partir do
-- JWT (auth.uid()), sem depender de custom claims.
--
-- security definer é necessário para ler public.profiles ignorando o RLS
-- dessa própria tabela dentro da função (senão haveria recursão: a política
-- de profiles dependeria de uma função que consulta profiles). O search_path
-- fixo evita hijacking via search_path malicioso.
--
-- Nota de evolução: se a subquery por linha virar gargalo de performance,
-- migrar para um custom claim `tenant_id` no JWT via Supabase Auth Hook e
-- trocar o corpo desta função por `(auth.jwt() ->> 'tenant_id')::uuid`, sem
-- precisar alterar nenhuma política que a usa.
-- ---------------------------------------------------------------------------
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profiles where user_id = auth.uid()
$$;

-- Tenant só é visível para quem pertence a ele.
create policy "tenants_select_own"
  on public.tenants for select
  using (id = public.current_tenant_id());
