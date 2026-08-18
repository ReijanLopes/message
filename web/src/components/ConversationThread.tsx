import { useState } from "react";
import type { FormEvent } from "react";
import type { Conversation, Message } from "../types";
import { one } from "../types";
import { ChannelBadge } from "./ChannelBadge";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function ConversationThread({
  conversation,
  messages,
  onSend,
  sending,
}: {
  conversation: Conversation | null;
  messages: Message[];
  onSend: (text: string) => Promise<void>;
  sending: boolean;
}) {
  const [draft, setDraft] = useState("");

  if (!conversation) {
    return (
      <div className="thread thread-empty">
        <p>Selecione uma conversa para começar.</p>
      </div>
    );
  }

  const contact = one(conversation.contact);
  const connection = one(conversation.channel_connection);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    await onSend(text);
    setDraft("");
  }

  return (
    <div className="thread">
      <div className="thread-header">
        <div>
          <strong>{contact?.display_name || contact?.handle}</strong>
          <span className="thread-handle">{contact?.handle}</span>
        </div>
        {connection && <ChannelBadge channelType={connection.channel_type} />}
      </div>

      <div className="thread-messages">
        {messages.map((message) => (
          <div key={message.id} className={`message-bubble ${message.direction}`}>
            {message.content.text && <p>{message.content.text}</p>}
            {message.content.attachments?.map((attachment, index) => (
              <a key={index} href={attachment.url} target="_blank" rel="noreferrer" className="attachment-link">
                {attachment.fileName ?? attachment.url}
              </a>
            ))}
            <span className="message-time">
              {formatTime(message.created_at)}
              {message.direction === "outbound" && message.status === "failed" && " · falhou"}
            </span>
          </div>
        ))}
      </div>

      <form className="thread-reply" onSubmit={handleSubmit}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Escreva uma resposta..."
          rows={2}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSubmit(event as unknown as FormEvent);
            }
          }}
        />
        <button type="submit" disabled={sending || draft.trim().length === 0}>
          {sending ? "Enviando..." : "Enviar"}
        </button>
      </form>
    </div>
  );
}
