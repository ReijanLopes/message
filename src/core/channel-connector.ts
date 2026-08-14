/**
 * Contrato que todo canal de mensageria deve implementar. É a única
 * superfície que o núcleo (api/, workers/, queue/) conhece — nenhum código
 * fora de connectors/<canal> pode saber o formato de payload de um provedor
 * específico.
 */

export interface MessageAttachment {
  url: string;
  contentType: string;
  fileName?: string;
}

export interface MessageContent {
  text?: string;
  attachments?: MessageAttachment[];
}

/** Representa uma conta de canal já conectada, com credenciais decifradas
 *  em memória (nunca persistidas assim — ver core/crypto.ts). */
export interface ChannelConnection {
  id: string;
  tenantId: string;
  channelType: string;
  displayName: string;
  status: "active" | "disabled" | "error";
  /** Formato específico do canal (ex.: { accessToken, phoneNumberId } para WhatsApp). */
  credentials: unknown;
  metadata: Record<string, unknown>;
}

/** Mensagem já convertida para o modelo agnóstico de canal, pronta para
 *  persistir sem qualquer conhecimento do provedor de origem. */
export interface NormalizedInboundMessage {
  channelConnectionId: string;
  /** id único da mensagem no provedor — base da deduplicação/idempotência. */
  channelMessageId: string;
  contact: {
    handle: string;
    displayName?: string;
  };
  content: MessageContent;
  timestamp: Date;
}

export interface SendResult {
  channelMessageId: string;
  status: "sent" | "failed";
  error?: string;
}

export interface ChannelConnector {
  /** Identificador único do canal: 'email', 'whatsapp', 'instagram', 'mock', ... */
  readonly channelType: string;

  /** Teto de processamento de webhooks inbound deste canal (jobs por
   *  `durationMs`), aplicado na fila dedicada do canal
   *  (`inbound-webhooks:<channelType>`). Cada canal deve declarar o limite
   *  real do provedor (ex.: WhatsApp Cloud API, limite de leitura IMAP).
   *  Se omitido, o worker usa `DEFAULT_RATE_LIMIT` (queue/index.ts). */
  readonly rateLimit?: { max: number; durationMs: number };

  /** Conecta a conta de UM tenant. Valida `credentials` (com zod, internamente)
   *  e retorna a ChannelConnection pronta para ser persistida — o chamador
   *  cuida de criptografar antes de salvar no banco. */
  connectAccount(tenantId: string, credentials: unknown): Promise<ChannelConnection>;

  /** Recebe o webhook bruto do provedor e devolve mensagens já normalizadas.
   *  Não deve tocar o banco — só parsing/normalização. */
  parseInboundWebhook(
    rawPayload: unknown,
    headers: Record<string, string>,
  ): Promise<NormalizedInboundMessage[]>;

  /** Valida a assinatura/autenticidade de um webhook antes de processá-lo.
   *  Deve operar sobre o corpo bruto (Buffer), não sobre JSON já parseado. */
  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string>): boolean;

  /** Envia uma mensagem a partir de uma conexão existente. */
  sendMessage(connection: ChannelConnection, to: string, content: MessageContent): Promise<SendResult>;
}
