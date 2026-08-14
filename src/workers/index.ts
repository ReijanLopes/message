import { Worker, type Job } from "bullmq";
import { getServiceRoleClient } from "../core/db.js";
import { connectorRegistry } from "../core/connector-registry.js";
import { registerConnectors } from "../connectors/register.js";
import {
  redisConnection,
  inboundQueueName,
  DEFAULT_RATE_LIMIT,
  type InboundWebhookJobData,
} from "../queue/index.js";
import type { NormalizedInboundMessage } from "../core/channel-connector.js";

registerConnectors();

/**
 * Persiste uma mensagem normalizada. Roda com service_role (não há usuário
 * logado processando um webhook) — por isso todo `tenant_id` usado aqui vem
 * do próprio banco (linha de channel_connections), nunca do payload do
 * provedor, e é conferido explicitamente antes de qualquer insert.
 */
async function persistInboundMessage(channelType: string, message: NormalizedInboundMessage) {
  const db = getServiceRoleClient();

  const { data: connection, error: connectionError } = await db
    .from("channel_connections")
    .select("id, tenant_id, status")
    .eq("id", message.channelConnectionId)
    .single();

  if (connectionError || !connection) {
    throw new Error(`channel_connection ${message.channelConnectionId} não encontrada`);
  }
  if (connection.status !== "active") {
    // conexão desativada depois do webhook ter sido disparado: descarta
    // silenciosamente em vez de falhar o job (evita retry infinito).
    return;
  }

  const tenantId = connection.tenant_id as string;

  const { data: contact, error: contactError } = await db
    .from("contacts")
    .upsert(
      {
        tenant_id: tenantId,
        channel_type: channelType,
        handle: message.contact.handle,
        display_name: message.contact.displayName ?? null,
      },
      { onConflict: "tenant_id,channel_type,handle" },
    )
    .select("id")
    .single();

  if (contactError || !contact) {
    throw new Error(`falha ao upsert contact: ${contactError?.message}`);
  }

  const { data: existingConversation } = await db
    .from("conversations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("contact_id", contact.id)
    .eq("channel_connection_id", message.channelConnectionId)
    .neq("status", "resolved")
    .limit(1)
    .maybeSingle();

  let conversationId = existingConversation?.id as string | undefined;
  if (!conversationId) {
    const { data: newConversation, error: createError } = await db
      .from("conversations")
      .insert({
        tenant_id: tenantId,
        contact_id: contact.id,
        channel_connection_id: message.channelConnectionId,
        status: "open",
      })
      .select("id")
      .single();
    if (createError || !newConversation) {
      throw new Error(`falha ao criar conversation: ${createError?.message}`);
    }
    conversationId = newConversation.id as string;
  }

  // ON CONFLICT DO NOTHING via ignoreDuplicates: reentrega do mesmo webhook
  // pelo provedor não duplica a mensagem (idempotência por channel_message_id).
  const { error: messageError } = await db.from("messages").upsert(
    {
      tenant_id: tenantId,
      conversation_id: conversationId,
      channel_connection_id: message.channelConnectionId,
      direction: "inbound",
      content: message.content,
      channel_message_id: message.channelMessageId,
      status: "received",
      created_at: message.timestamp.toISOString(),
    },
    { onConflict: "tenant_id,channel_connection_id,channel_message_id", ignoreDuplicates: true },
  );

  if (messageError) {
    throw new Error(`falha ao inserir message: ${messageError.message}`);
  }

  await db
    .from("conversations")
    .update({ last_message_at: message.timestamp.toISOString() })
    .eq("id", conversationId);

  await db.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_user_id: null,
    action: "message.received",
    metadata: { channelType, conversationId, channelMessageId: message.channelMessageId },
  });
}

async function processInboundWebhookJob(job: Job<InboundWebhookJobData>) {
  const { channelType, rawPayload, headers } = job.data;
  const connector = connectorRegistry.get(channelType);
  const messages = await connector.parseInboundWebhook(rawPayload, headers);
  for (const message of messages) {
    await persistInboundMessage(channelType, message);
  }
}

/**
 * Um Worker BullMQ por canal registrado, cada um lendo da sua própria fila
 * (`inbound-webhooks:<channelType>`) com o rate limit que o conector declara
 * (`connector.rateLimit`, ver core/channel-connector.ts) — ou o teto padrão
 * se o conector não declarar nenhum. Isso evita que um canal com muito
 * tráfego (ou um provedor com limite baixo) atrase o processamento dos
 * outros canais: o limiter do BullMQ é por fila, não global.
 *
 * Canais registrados depois do worker já estar de pé exigem reiniciar o
 * processo — aceitável no MVP, já que os conectores são fixos no bootstrap.
 */
const inboundWorkers = connectorRegistry.list().map((channelType) => {
  const connector = connectorRegistry.get(channelType);
  const rateLimit = connector.rateLimit ?? DEFAULT_RATE_LIMIT;

  const worker = new Worker<InboundWebhookJobData>(inboundQueueName(channelType), processInboundWebhookJob, {
    connection: redisConnection,
    concurrency: 5,
    limiter: { max: rateLimit.max, duration: rateLimit.durationMs },
  });

  worker.on("failed", (job, err) => {
    console.error(`[worker:${channelType}] job ${job?.id} falhou:`, err.message);
  });
  worker.on("completed", (job) => {
    console.log(`[worker:${channelType}] job ${job.id} processado com sucesso`);
  });

  return worker;
});

if (inboundWorkers.length === 0) {
  console.warn("[worker] nenhum conector registrado — nenhuma fila sendo consumida.");
}
