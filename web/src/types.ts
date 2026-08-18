export interface Contact {
  id: string;
  handle: string;
  display_name: string | null;
  channel_type: string;
}

export interface ChannelConnectionSummary {
  id: string;
  channel_type: string;
  display_name: string;
}

export interface Conversation {
  id: string;
  status: "open" | "pending" | "resolved";
  last_message_at: string | null;
  created_at: string;
  contact: Contact;
  channel_connection: ChannelConnectionSummary;
}

export interface MessageAttachment {
  url: string;
  contentType: string;
  fileName?: string;
}

export interface MessageContent {
  text?: string;
  attachments?: MessageAttachment[];
}

export interface Message {
  id: string;
  direction: "inbound" | "outbound";
  content: MessageContent;
  status: string;
  channel_message_id: string | null;
  created_at: string;
}

/**
 * O PostgREST (via supabase-js) às vezes devolve uma relação to-one como
 * objeto, às vezes como array de 1 elemento, dependendo de como a FK é
 * inferida. Normaliza os dois casos.
 */
export function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
