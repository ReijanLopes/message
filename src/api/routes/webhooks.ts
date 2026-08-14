import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { connectorRegistry } from "../../core/connector-registry.js";
import { getInboundWebhooksQueue } from "../../queue/index.js";

const paramsSchema = z.object({
  channelType: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_-]+$/, "channelType deve ser slug minúsculo"),
});

function flattenHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      flat[key] = value;
    } else if (Array.isArray(value)) {
      flat[key] = value.join(", ");
    }
  }
  return flat;
}

/**
 * Endpoint público e agnóstico de canal: POST /webhooks/:channelType
 *
 * Fluxo (nunca processa nada de forma síncrona além da verificação):
 *  1. resolve o conector pelo channelType (nenhum `if (channel === ...)` aqui);
 *  2. verifica a assinatura sobre o corpo BRUTO — payload não assinado é 401;
 *  3. empurra para a fila e responde 200 imediatamente.
 */
export async function registerWebhookRoutes(app: FastifyInstance) {
  app.post(
    "/webhooks/:channelType",
    {
      config: {
        rateLimit: { max: 300, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "invalid_channel_type" });
      }
      const { channelType } = params.data;

      if (!connectorRegistry.has(channelType)) {
        return reply.code(404).send({ error: "unknown_channel" });
      }
      const connector = connectorRegistry.get(channelType);

      const rawBody = request.rawBody;
      if (!rawBody) {
        return reply.code(400).send({ error: "empty_body" });
      }
      const headers = flattenHeaders(request.headers);

      const isValid = connector.verifyWebhookSignature(rawBody, headers);
      if (!isValid) {
        request.log.warn({ channelType }, "webhook rejeitado: assinatura inválida");
        return reply.code(401).send({ error: "invalid_signature" });
      }

      await getInboundWebhooksQueue(channelType).add("process", {
        channelType,
        rawPayload: request.body,
        headers,
        receivedAt: new Date().toISOString(),
      });

      return reply.code(200).send({ status: "queued" });
    },
  );
}
