# mensagens — Caixa de Entrada Unificada (MVP)

SaaS omnichannel: cada empresa cliente (tenant) conecta suas contas de mensageria
(WhatsApp, e-mail, Instagram, ...) e atende tudo numa única inbox.

> Status: **Bloco 1 — Núcleo** concluído (schema + RLS, connector registry, fila
> por canal, webhook genérico, worker, API de conversas/mensagens, camada de
> auth) e **frontend mínimo da inbox** (`web/`) já conectado à API.
> `MockConnector` e o teste ponta-a-ponta chegam no bloco 2 — sem um conector
> registrado a inbox fica vazia (não há como um canal enviar mensagens ainda).

## Rodando localmente

Pré-requisitos: Node 20+, Docker, [Supabase CLI](https://supabase.com/docs/guides/cli).

### Primeira vez (setup)

```bash
npm install
cd web && npm install && cp .env.example .env && cd ..
```

Crie um `.env` na raiz (não versionado) com as variáveis abaixo — preenchidas
no próximo passo:

```bash
# Supabase (projeto local via `supabase start`, ou projeto remoto)
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=replace-me
# NUNCA exponha esta chave ao frontend. Usada só pelo worker/jobs de sistema.
SUPABASE_SERVICE_ROLE_KEY=replace-me

# Redis (BullMQ)
REDIS_URL=redis://127.0.0.1:6379

# Chave mestra para criptografar credenciais de canais (AES-256-GCM).
# Gere com: openssl rand -base64 32
CREDENTIALS_ENCRYPTION_KEY=replace-me-32-bytes-base64

# API
API_PORT=3000
API_HOST=0.0.0.0
# Origens de frontend permitidas (CORS), separadas por vírgula
CORS_ALLOWED_ORIGINS=http://localhost:5173

NODE_ENV=development
```

Suba a infra e aplique as migrations:

```bash
docker compose up -d          # sobe o Redis
supabase start                # sobe Postgres + Auth + Storage local
supabase db reset             # aplica as migrations em supabase/migrations
```

`supabase start` imprime a `anon key` e a `service_role key` locais — copie
para `.env` (raiz) e para `web/.env` (`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`
usam a mesma anon key). Gere `CREDENTIALS_ENCRYPTION_KEY` com:

```bash
openssl rand -base64 32
```

Garanta que `CORS_ALLOWED_ORIGINS` no `.env` inclui a origem do frontend
(`http://localhost:5173`, a porta padrão do Vite) — senão o navegador bloqueia
as chamadas à API.

### Dia a dia (tudo junto)

```bash
npm start
```

Sobe o Redis + Supabase local (`dev:infra`, idempotente — pode rodar de novo
sem quebrar nada se já estiverem de pé) e, em seguida, API + worker + frontend
juntos via [`concurrently`](https://www.npmjs.com/package/concurrently), com
saída colorida e prefixada por processo (`api`, `worker`, `web`). `Ctrl+C`
encerra os três.

Se a infra (Redis/Supabase) já estiver rodando, pule direto para
`npm run dev` — só sobe API + worker + frontend.

Para rodar cada peça isoladamente (debug, logs mais limpos):

```bash
npm run dev:api      # http://localhost:3000/health
npm run dev:worker
npm run dev:web       # http://localhost:5173
```

O login do frontend é feito via Supabase Auth (e-mail/senha); para um
usuário conseguir ver conversas ele precisa ter uma
linha em `public.profiles` ligando-o a um `tenant_id` — esse fluxo de
onboarding/convite ainda não tem UI (é feito manualmente via `service_role`
ou SQL direto no MVP). Sem profile, a API responde 403 e a inbox mostra um
aviso em vez de travar.

A lista de conversas e a thread aberta são atualizadas por **polling**
simples (5s e 3s respectivamente) — não há websocket/Supabase Realtime neste
MVP.

## Testes

Ainda não há testes automatizados — `npm test` (vitest) já está configurado,
mas o primeiro teste real chega no próximo bloco junto com o `MockConnector`,
que serve como teste vivo de ponta a ponta (webhook → fila → worker → inbox →
resposta → envio) sem precisar de credenciais de canal real.

## Como adicionar um canal novo

1. Crie `src/connectors/<canal>/index.ts` implementando `ChannelConnector`
   (`src/core/channel-connector.ts`): `connectAccount`, `parseInboundWebhook`,
   `verifyWebhookSignature`, `sendMessage`.
2. Registre a instância em `src/connectors/register.ts`:
   `connectorRegistry.register(new MeuConnector())`.
3. Pronto. A rota de webhook (`POST /webhooks/:channelType`), a fila, o worker
   e a API de conversas já funcionam para o canal novo sem nenhuma alteração —
   eles só conhecem a interface, nunca um canal específico.

Nenhum arquivo de `src/api`, `src/workers` ou `src/core` deve conter um `if`
comparando `channelType` a um canal específico. Se isso acontecer, é sinal de
que lógica de canal vazou para o núcleo.

## Modelo de segurança

**Isolamento multi-tenant por RLS, não por filtro em memória.** Toda tabela
tem `tenant_id` e RLS ligado (ver `supabase/migrations`). A política usa
`public.current_tenant_id()`, uma função que resolve o tenant do usuário
autenticado a partir de `public.profiles` (ligada a `auth.uid()`), sem
depender de custom claims no JWT.

**Como as três peças se encaixam:**

| Contexto | Client usado | RLS ativo? | Quem garante o isolamento |
|---|---|---|---|
| Rota autenticada da API (frontend → backend) | `createUserScopedClient(jwt)` — anon key + `Authorization: Bearer <jwt do usuário>` | Sim | Postgres (RLS) |
| Worker processando webhook | `getServiceRoleClient()` — `service_role` | **Não** (ignora RLS) | Código: `tenant_id` sempre resolvido do banco (via `channel_connection.id`) e nunca aceito do payload do provedor |
| Webhook recebido do canal | nenhum JWT de usuário | n/a | Assinatura HMAC (`verifyWebhookSignature`) sobre o corpo bruto |

Regra prática: **se o código responde a uma requisição HTTP de um usuário
logado, use sempre o client user-scoped.** `service_role` só existe em
`src/workers` e nunca deve ser importada por `src/api`.

Outros controles já no lugar:

- **Credenciais de canal** criptografadas em repouso com AES-256-GCM
  (`src/core/crypto.ts`); a chave-mestra vive em `CREDENTIALS_ENCRYPTION_KEY`
  (env / secrets manager), nunca no código.
- **Webhooks** verificam assinatura sobre o `Buffer` bruto antes de
  responder 200 e antes de qualquer enfileiramento; payload não assinado
  recebe 401 e não entra na fila.
- **Idempotência**: `messages` tem `unique(tenant_id, channel_connection_id,
  channel_message_id)`; reentrega do mesmo webhook não duplica mensagem.
- **Validação de entrada** com zod em params/body de toda rota HTTP.
- **Rate limiting** em duas camadas: por IP/rota na API (`@fastify/rate-limit`,
  webhooks com teto próprio), e por canal no processamento assíncrono — cada
  `channelType` tem sua própria fila (`inbound-webhooks:<channelType>`) e seu
  próprio `Worker` no BullMQ, limitado por `connector.rateLimit` (teto do
  provedor daquele canal) ou por `DEFAULT_RATE_LIMIT` se o conector não
  declarar um (`src/queue/index.ts`, `src/workers/index.ts`). Assim um canal
  não estoura o limite do provedor nem atrasa o processamento dos outros.
- **Cabeçalhos/transporte**: `@fastify/helmet`, CORS restrito a
  `CORS_ALLOWED_ORIGINS`, logs com `Authorization`/`Cookie` redigidos.
- `.env` fora do versionamento (`.gitignore`); nunca logar segredos ou
  conteúdo de credenciais.

## Estrutura

```
src/
  core/        # ChannelConnector, registry, clients Supabase, crypto, config — não conhece canais
  connectors/  # implementações por canal (mock/, email/, whatsapp/, ...)
  api/         # Fastify: server, plugin de auth, rotas
  workers/     # consumidor da fila que normaliza → persiste
  queue/       # setup BullMQ
supabase/
  migrations/  # schema + RLS versionados
web/
  src/
    lib/           # client Supabase (auth) + wrapper fetch da API
    components/     # Login, ConversationList, ConversationThread, ChannelBadge
    App.tsx          # layout, polling, orquestração
```
