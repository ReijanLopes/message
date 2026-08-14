import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../core/config.js";

export interface InboundWebhookJobData {
  channelType: string;
  /** Payload já parseado (JSON). A verificação de assinatura acontece antes
   *  de enfileirar, na rota HTTP, sobre o Buffer bruto — o worker só recebe
   *  payload já autenticado. */
  rawPayload: unknown;
  headers: Record<string, string>;
  receivedAt: string;
}

// Uma única conexão Redis compartilhada pelo processo (API produz, worker consome).
export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

/**
 * Rate limit aplicado quando o conector do canal não declara o próprio
 * `rateLimit` (ver core/channel-connector.ts). É só um teto conservador —
 * cada canal real deve declarar o limite do provedor dele.
 */
export const DEFAULT_RATE_LIMIT = { max: 60, durationMs: 60_000 };

/**
 * Uma fila BullMQ por canal (`inbound-webhooks:<channelType>`), não uma fila
 * única compartilhada. Isso é o que permite rate-limitar cada canal pelo
 * limite do provedor dele (ex.: WhatsApp Cloud API vs. IMAP) sem que um
 * canal congestionado atrase os outros — o limiter do BullMQ é por fila.
 */
const inboundQueues = new Map<string, Queue<InboundWebhookJobData>>();

export function inboundQueueName(channelType: string): string {
  return `inbound-webhooks:${channelType}`;
}

export function getInboundWebhooksQueue(channelType: string): Queue<InboundWebhookJobData> {
  let queue = inboundQueues.get(channelType);
  if (!queue) {
    queue = new Queue<InboundWebhookJobData>(inboundQueueName(channelType), {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    });
    inboundQueues.set(channelType, queue);
  }
  return queue;
}
