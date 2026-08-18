import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { ApiError, fetchConversations, fetchMessages, sendMessage } from "./lib/api";
import type { Conversation, Message } from "./types";
import { Login } from "./components/Login";
import { ConversationList } from "./components/ConversationList";
import { ConversationThread } from "./components/ConversationThread";

const CONVERSATIONS_POLL_MS = 5000;
const MESSAGES_POLL_MS = 3000;

export default function App() {
  // undefined = sessão ainda não resolvida (evita flash da tela de login)
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => subscription.unsubscribe();
  }, []);

  const accessToken = session?.access_token;

  const reloadConversations = useCallback(async () => {
    if (!accessToken) return;
    try {
      const { conversations } = await fetchConversations(accessToken);
      setConversations(conversations);
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(
        err instanceof ApiError && err.status === 403
          ? "Seu usuário ainda não está associado a nenhuma empresa (tenant). Peça para um admin te convidar."
          : "Não foi possível carregar as conversas.",
      );
    }
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    void reloadConversations();
    const interval = setInterval(() => void reloadConversations(), CONVERSATIONS_POLL_MS);
    return () => clearInterval(interval);
  }, [accessToken, reloadConversations]);

  const reloadMessages = useCallback(async () => {
    if (!accessToken || !selectedId) return;
    try {
      const { messages } = await fetchMessages(accessToken, selectedId);
      setMessages(messages);
    } catch {
      // silencioso: o próximo poll tenta de novo
    }
  }, [accessToken, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    void reloadMessages();
    const interval = setInterval(() => void reloadMessages(), MESSAGES_POLL_MS);
    return () => clearInterval(interval);
  }, [selectedId, reloadMessages]);

  async function handleSend(text: string) {
    if (!accessToken || !selectedId) return;
    setSending(true);
    try {
      await sendMessage(accessToken, selectedId, { text });
      await reloadMessages();
      await reloadConversations();
    } catch {
      setErrorMessage("Falha ao enviar a mensagem.");
    } finally {
      setSending(false);
    }
  }

  if (session === undefined) {
    return <div className="app-loading">Carregando...</div>;
  }
  if (!session) {
    return <Login />;
  }

  const selectedConversation = conversations.find((conversation) => conversation.id === selectedId) ?? null;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>Inbox</h1>
          <button className="logout-button" onClick={() => void supabase.auth.signOut()}>
            Sair
          </button>
        </div>
        {errorMessage && <div className="banner-error">{errorMessage}</div>}
        <ConversationList conversations={conversations} selectedId={selectedId} onSelect={setSelectedId} />
      </aside>
      <main>
        <ConversationThread
          conversation={selectedConversation}
          messages={messages}
          onSend={handleSend}
          sending={sending}
        />
      </main>
    </div>
  );
}
