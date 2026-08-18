import type { Conversation, Message, MessageContent } from "../types";

const API_URL = import.meta.env.VITE_API_URL;

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function apiFetch<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `request_failed_${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

export { ApiError };

export function fetchConversations(accessToken: string): Promise<{ conversations: Conversation[] }> {
  return apiFetch("/conversations", accessToken);
}

export function fetchMessages(accessToken: string, conversationId: string): Promise<{ messages: Message[] }> {
  return apiFetch(`/conversations/${conversationId}/messages`, accessToken);
}

export function sendMessage(
  accessToken: string,
  conversationId: string,
  content: MessageContent,
): Promise<{ message: Message }> {
  return apiFetch(`/conversations/${conversationId}/messages`, accessToken, {
    method: "POST",
    body: JSON.stringify(content),
  });
}
