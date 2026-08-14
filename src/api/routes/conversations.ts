import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { connectorRegistry } from "../../core/connector-registry.js";
import { decryptCredentials } from "../../core/crypto.js";
import type { ChannelConnection, MessageContent } from "../../core/channel-connector.js";

const idParamSchema = z.object({ id: z.string().uuid() });

const sendMessageBodySchema = z.object({
  text: z.string().min(1).max(4096).optional(),
  attachments: z
    .array(
      z.object({
        url: z.string().url(),
        contentType: z.string().min(1),
        fileName: z.string().optional(),
      }),
    )
    .optional(),
}).refine((body) => Boolean(body.text) || (body.attachments?.length ?? 0) > 0, {
  message: "mensagem precisa de texto ou ao menos um anexo",
});

/**
 * Rotas autenticadas da inbox. Todas usam `request.auth.supabase` (client
 * com o JWT do usuário propagado) — o isolamento entre tenants é garantido
 * pelo RLS no Postgres, não por um `where tenant_id = ...` manual (que
 * também aplicamos, como defesa em profundidade).
 */
export async function registerConversationRoutes(app: FastifyInstance) {
  app.get(
    "/conversations",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { supabase, tenantId } = request.auth!;
      const { data, error } = await supabase
        .from("conversations")
        .select(
          "id, status, last_message_at, created_at, contact:contacts(id, handle, display_name, channel_type), channel_connection:channel_connections(id, channel_type, display_name)",
        )
        .eq("tenant_id", tenantId)
        .order("last_message_at", { ascending: false, nullsFirst: false });

      if (error) {
        request.log.error({ err: error }, "falha ao listar conversas");
        return reply.code(500).send({ error: "internal_error" });
      }
      return { conversations: data };
    },
  );

  app.get(
    "/conversations/:id/messages",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "invalid_conversation_id" });
      }
      const { supabase, tenantId } = request.auth!;

      const { data, error } = await supabase
        .from("messages")
        .select("id, direction, content, status, channel_message_id, created_at")
        .eq("tenant_id", tenantId)
        .eq("conversation_id", params.data.id)
        .order("created_at", { ascending: true });

      if (error) {
        request.log.error({ err: error }, "falha ao listar mensagens");
        return reply.code(500).send({ error: "internal_error" });
      }
      return { messages: data };
    },
  );

  app.post(
    "/conversations/:id/messages",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "invalid_conversation_id" });
      }
      const body = sendMessageBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });
      }
      const { supabase, tenantId, userId } = request.auth!;

      const { data: conversation, error: conversationError } = await supabase
        .from("conversations")
        .select(
          "id, contact:contacts(handle), channel_connection:channel_connections(id, channel_type, status, credentials_encrypted, display_name, tenant_id)",
        )
        .eq("tenant_id", tenantId)
        .eq("id", params.data.id)
        .single();

      if (conversationError || !conversation) {
        return reply.code(404).send({ error: "conversation_not_found" });
      }

      const connectionRow = Array.isArray(conversation.channel_connection)
        ? conversation.channel_connection[0]
        : conversation.channel_connection;
      const contactRow = Array.isArray(conversation.contact) ? conversation.contact[0] : conversation.contact;

      if (!connectionRow || !contactRow) {
        return reply.code(409).send({ error: "conversation_missing_connection_or_contact" });
      }
      if (connectionRow.status !== "active") {
        return reply.code(409).send({ error: "channel_connection_not_active" });
      }

      const connector = connectorRegistry.get(connectionRow.channel_type);
      const connection: ChannelConnection = {
        id: connectionRow.id,
        tenantId,
        channelType: connectionRow.channel_type,
        displayName: connectionRow.display_name,
        status: connectionRow.status,
        credentials: JSON.parse(decryptCredentials(connectionRow.credentials_encrypted)),
        metadata: {},
      };

      const content: MessageContent = {
        text: body.data.text,
        attachments: body.data.attachments,
      };

      const result = await connector.sendMessage(connection, contactRow.handle, content);

      const { data: message, error: insertError } = await supabase
        .from("messages")
        .insert({
          tenant_id: tenantId,
          conversation_id: params.data.id,
          channel_connection_id: connectionRow.id,
          direction: "outbound",
          content,
          channel_message_id: result.channelMessageId,
          status: result.status === "sent" ? "sent" : "failed",
        })
        .select()
        .single();

      if (insertError) {
        request.log.error({ err: insertError }, "falha ao persistir mensagem enviada");
        return reply.code(500).send({ error: "internal_error" });
      }

      await supabase.from("audit_logs").insert({
        tenant_id: tenantId,
        actor_user_id: userId,
        action: "message.sent",
        metadata: { conversationId: params.data.id, channelType: connectionRow.channel_type },
      });

      return reply.code(201).send({ message });
    },
  );
}
