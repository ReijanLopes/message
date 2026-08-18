import type { Conversation } from "../types";
import { one } from "../types";
import { ChannelBadge } from "./ChannelBadge";

function formatTimestamp(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

const STATUS_LABEL: Record<Conversation["status"], string> = {
  open: "Aberta",
  pending: "Pendente",
  resolved: "Resolvida",
};

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
}: {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (conversations.length === 0) {
    return <div className="conversation-list-empty">Nenhuma conversa ainda.</div>;
  }

  return (
    <ul className="conversation-list">
      {conversations.map((conversation) => {
        const contact = one(conversation.contact);
        const connection = one(conversation.channel_connection);
        const title = contact?.display_name || contact?.handle || "Contato desconhecido";

        return (
          <li key={conversation.id}>
            <button
              className={`conversation-item ${conversation.id === selectedId ? "selected" : ""}`}
              onClick={() => onSelect(conversation.id)}
            >
              <div className="conversation-item-top">
                <span className="conversation-title">{title}</span>
                <span className="conversation-time">{formatTimestamp(conversation.last_message_at)}</span>
              </div>
              <div className="conversation-item-bottom">
                {connection && <ChannelBadge channelType={connection.channel_type} />}
                <span className={`status-pill status-${conversation.status}`}>
                  {STATUS_LABEL[conversation.status]}
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
