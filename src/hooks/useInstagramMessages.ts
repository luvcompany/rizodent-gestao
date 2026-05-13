import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface InstagramMessage {
  id: string;
  instagram_account_id: string | null;
  instagram_account_config_id: string | null;
  sender_id: string | null;
  sender_name: string | null;
  sender_profile_pic: string | null;
  message_text: string | null;
  message_type: string | null;
  post_id: string | null;
  comment_id: string | null;
  lead_id: string | null;
  is_outbound: boolean;
  is_read: boolean;
  created_at: string;
  status?: string | null;
  replied_at?: string | null;
  reply_text?: string | null;
  account_name?: string | null;
}

export interface InstagramConversation {
  sender_id: string;
  sender_name: string | null;
  sender_profile_pic: string | null;
  last_message: string | null;
  last_message_time: string;
  unread_count: number;
  message_type: "dm" | "comment" | null;
  instagram_account_id: string | null;
  account_name: string | null;
}

export interface SendMessageParams {
  instagram_account_id: string;
  recipient_id: string;
  message: string;
  message_type: "dm" | "comment";
  comment_id?: string;
}

type InstagramSendResponse = {
  ok?: boolean;
  error?: string;
  error_code?: string;
  user_message?: string;
  setup_required?: boolean;
};

export function useInstagramMessages() {
  const [messages, setMessages] = useState<InstagramMessage[]>([]);
  const [accountsMap, setAccountsMap] = useState<Record<string, string>>({});
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: accounts, error: accErr }, { data: msgs, error: msgErr }] = await Promise.all([
        supabase.from("instagram_accounts").select("instagram_account_id, name"),
        supabase.from("instagram_messages").select("*").order("created_at", { ascending: false }),
      ]);

      if (accErr) throw accErr;
      if (msgErr) throw msgErr;

      const map: Record<string, string> = {};
      (accounts ?? []).forEach((a: any) => {
        if (a.instagram_account_id) map[a.instagram_account_id] = a.name ?? "";
      });
      setAccountsMap(map);
      setMessages((msgs as InstagramMessage[]) ?? []);
    } catch (e: any) {
      console.error("[useInstagramMessages] load error", e);
      setError(e?.message ?? "Erro ao carregar mensagens do Instagram");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();

    const channel = supabase
      .channel("instagram_messages_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "instagram_messages" },
        (payload) => {
          setMessages((prev) => {
            if (payload.eventType === "INSERT") {
              const next = [payload.new as InstagramMessage, ...prev];
              return next;
            }
            if (payload.eventType === "UPDATE") {
              return prev.map((m) =>
                m.id === (payload.new as InstagramMessage).id ? (payload.new as InstagramMessage) : m
              );
            }
            if (payload.eventType === "DELETE") {
              return prev.filter((m) => m.id !== (payload.old as InstagramMessage).id);
            }
            return prev;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadAll]);

  const conversations: InstagramConversation[] = useMemo(() => {
    const grouped = new Map<string, InstagramConversation>();
    // messages already DESC; iterate to set latest first occurrence
    for (const m of messages) {
      const sid = m.sender_id ?? "unknown";
      const existing = grouped.get(sid);
      if (!existing) {
        grouped.set(sid, {
          sender_id: sid,
          sender_name: m.sender_name,
          sender_profile_pic: m.sender_profile_pic,
          last_message: m.message_text,
          last_message_time: m.created_at,
          unread_count: !m.is_read && !m.is_outbound ? 1 : 0,
          message_type: (m.message_type as "dm" | "comment" | null) ?? null,
          instagram_account_id: m.instagram_account_id,
          account_name: m.instagram_account_id ? accountsMap[m.instagram_account_id] ?? null : null,
        });
      } else {
        if (!existing.sender_profile_pic && m.sender_profile_pic) {
          existing.sender_profile_pic = m.sender_profile_pic;
        }
        if (!existing.sender_name && m.sender_name) {
          existing.sender_name = m.sender_name;
        }
        if (!m.is_read && !m.is_outbound) existing.unread_count += 1;
      }
    }
    return Array.from(grouped.values()).sort(
      (a, b) => new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime()
    );
  }, [messages, accountsMap]);

  const conversationMessages = useMemo(() => {
    if (!selectedConversationId) return [] as InstagramMessage[];
    return messages
      .filter((m) => m.sender_id === selectedConversationId)
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [messages, selectedConversationId]);

  const sendMessage = useCallback(async (params: SendMessageParams) => {
    const { data, error: invokeErr } = await supabase.functions.invoke("instagram-send-message", {
      body: params,
    });
    if (invokeErr) throw invokeErr;
    const response = data as InstagramSendResponse | null;
    if (response?.ok === false) {
      throw new Error(response.user_message || response.error || "Erro ao enviar mensagem no Instagram");
    }
    return data;
  }, []);

  const markAsRead = useCallback(async (sender_id: string) => {
    const { error: updErr } = await supabase
      .from("instagram_messages")
      .update({ is_read: true })
      .eq("sender_id", sender_id)
      .eq("is_read", false);
    if (updErr) {
      console.error("[useInstagramMessages] markAsRead error", updErr);
    }
  }, []);

  const replyToMessage = useCallback(
    async (message: InstagramMessage, replyText: string) => {
      if (!message.instagram_account_id) {
        throw new Error("Conta do Instagram não identificada");
      }
      const isComment = message.message_type === "comment";
      const { data, error: invokeErr } = await supabase.functions.invoke("instagram-reply", {
        body: {
          event_id: message.id,
          ig_account_id: message.instagram_account_id,
          sender_id: message.sender_id ?? undefined,
          comment_id: isComment ? message.comment_id ?? undefined : undefined,
          reply_text: replyText,
          event_type: isComment ? "comments" : "dm",
        },
      });
      if (invokeErr) throw invokeErr;
      const resp = data as { success?: boolean; error?: string } | null;
      if (resp && resp.success === false) {
        throw new Error(resp.error || "Erro ao responder no Instagram");
      }
      return data;
    },
    []
  );

  return {
    conversations,
    messages: conversationMessages,
    selectedConversationId,
    setSelectedConversationId,
    sendMessage,
    replyToMessage,
    markAsRead,
    loading,
    error,
    reload: loadAll,
  };
}
