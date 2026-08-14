import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../core/config.js";
import { createUserScopedClient } from "../../core/db.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Presente somente após `authenticate` rodar com sucesso. */
    auth?: {
      userId: string;
      tenantId: string;
      /** Client Supabase com o JWT do usuário propagado — RLS aplica de verdade. */
      supabase: SupabaseClient;
    };
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

// Client anon dedicado só para validar tokens via Supabase Auth (GoTrue).
// Não propaga JWT nenhum: é usado apenas para chamar auth.getUser(token).
const authClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Plugin de autenticação. Expõe `fastify.authenticate`, um preHandler que:
 *  1. extrai o Bearer token do header Authorization;
 *  2. valida o token contra o Supabase Auth (assinatura + expiração);
 *  3. resolve o tenant do usuário lendo public.profiles (via client
 *     user-scoped, então passa pelo RLS de profiles: usuário só lê o
 *     próprio profile — ver migration 0001);
 *  4. decora `request.auth` com userId, tenantId e um client Supabase
 *     que propaga o JWT do usuário para todas as queries subsequentes.
 *
 * Rotas de webhook (canal -> backend) NUNCA usam este plugin: sua
 * autenticidade vem da verificação de assinatura do provedor, não de um
 * usuário logado.
 */
const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "missing_bearer_token" });
    }
    const jwt = authHeader.slice("Bearer ".length);

    const { data: userData, error: userError } = await authClient.auth.getUser(jwt);
    if (userError || !userData.user) {
      return reply.code(401).send({ error: "invalid_token" });
    }

    const userScopedClient = createUserScopedClient(jwt);
    const { data: profile, error: profileError } = await userScopedClient
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", userData.user.id)
      .single();

    if (profileError || !profile) {
      return reply.code(403).send({ error: "no_tenant_profile" });
    }

    request.auth = {
      userId: userData.user.id,
      tenantId: profile.tenant_id as string,
      supabase: userScopedClient,
    };
  });
};

export default fp(authPlugin, { name: "auth-plugin" });
