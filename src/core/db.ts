import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./config.js";

/**
 * Client "por-usuário": usa a anon key mas propaga o JWT do usuário logado
 * no header Authorization. É esse JWT que o PostgREST repassa ao Postgres
 * como `request.jwt.claims`, fazendo `auth.uid()` funcionar dentro do RLS.
 *
 * USE SEMPRE este client nas rotas autenticadas da API — nunca o
 * service-role client abaixo. É o RLS, não o código do app, quem garante o
 * isolamento entre tenants aqui.
 */
export function createUserScopedClient(userJwt: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${userJwt}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Client com service_role: IGNORA o RLS por completo. Só pode ser usado no
 * worker/jobs de sistema, e mesmo assim todo insert/update deve informar
 * `tenant_id` explicitamente e validado em código — não existe rede de
 * segurança do banco aqui. Nunca importar isto em código que responde a uma
 * requisição de frontend, e nunca expor esta chave ao cliente.
 */
let serviceRoleClient: SupabaseClient | undefined;

export function getServiceRoleClient(): SupabaseClient {
  serviceRoleClient ??= createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return serviceRoleClient;
}
