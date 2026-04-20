import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type InstagramMessage = {
  id: string;
  instagram_account_id: string | null;
  sender_id: string | null;
  sender_name: string | null;
  sender_profile_pic: string | null;
  message_text: string | null;
  message_type: string | null;
  post_id: string | null;
  comment_id: string | null;
  is_read: boolean;
  is_outbound: boolean;
  lead_id: string | null;
  created_at: string;
  account_name?: string | null;
};

export type InstagramConversation = {
  sender_id: string;
  sender_name: string | null;
  sender_profile_pic: string | null;
  last_message: string | null;
  last_message_time: string;
  unread_count: number;
  message_type: string | null;
  instagram_account_id: string | null;
  account_name: string | null;
};

export function useInstagramMessages() {
  const [allMessages, setAllMessages] = useState<InstagramMessage[]>([]);
  const [accountsMap, setAccountsMap] = useState<Record<string, string>>({});
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [msgsRes, accountsRes] = await Promise.all([
      supabase
        .from("instagram_messages")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(2000),
      supabase.from("instagram_accounts").select("instagram_account_id, name"),
    ]);
    if (msgsRes.error) {
      setError(msgsRes.error.message);
      setLoading(false);
      return;
    }
    const map: Record<string, string> = {};
    (accountsRes.data || []).forEach((a: { instagram_account_id: string | null; name: string | null }) => {
      if (a.instagram_account_id) map[a.instagram_account_id] = a.name ?? "";
    });
    setAccountsMap(map);
    setAllMessages(((msgsRes.data || []) as InstagramMessage[]).map((m) => ({
      ...m,
      account_name: m.instagram_account_id ? map[m.instagram_account_id] ?? null : null,
    })));
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel("instagram-messages-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "instagram_messages" },
        (payload) => {
          console.log("[realtime] Nova mensagem Instagram:", payload.new);
          const newMsg = payload.new as InstagramMessage;
          setAllMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, {
              ...newMsg,
              account_name: newMsg.instagram_account_id ? accountsMap[newMsg.instagram_account_id] ?? null : null,
            }];
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "instagram_messages" },
        (payload) => {
          const upd = payload.new as InstagramMessage;
          setAllMessages((prev) => prev.map((m) => (m.id === upd.id ? { ...m, ...upd } : m)));
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "instagram_messages" },
        (payload) => {
          const oldId = (payload.old as { id: string }).id;
          setAllMessages((prev) => prev.filter((m) => m.id !== oldId));
        },
      )
      .subscribe((status) => {
        console.log("[realtime] instagram-messages channel status:", status);
      });
    return () => { supabase.removeChannel(channel); };
  }, [accountsMap]);

  const conversations: InstagramConversation[] = useMemo(() => {
    const groups = new Map<string, InstagramMessage[]>();
    for (const m of allMessages) {
      const key = m.sender_id ?? "unknown";
      const list = groups.get(key) ?? [];
      list.push(m);
      groups.set(key, list);
    }
    const result: InstagramConversation[] = [];
    for (const [sender_id, msgs] of groups) {
      const sorted = msgs.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
      const last = sorted[sorted.length - 1];
      const inboundUnread = msgs.filter((m) => !m.is_outbound && !m.is_read).length;
      // Pega a foto/nome mais recente disponível em mensagens inbound
      const inboundWithPic = [...sorted].reverse().find((m) => !m.is_outbound && (m.sender_profile_pic || m.sender_name));
      result.push({
        sender_id,
        sender_name: inboundWithPic?.sender_name ?? last.sender_name,
        sender_profile_pic: inboundWithPic?.sender_profile_pic ?? null,
        last_message: last.message_text,
        last_message_time: last.created_at,
        unread_count: inboundUnread,
        message_type: last.message_type,
        instagram_account_id: last.instagram_account_id,
        account_name: last.account_name ?? null,
      });
    }
    return result.sort((a, b) => b.last_message_time.localeCompare(a.last_message_time));
  }, [allMessages]);

  const messages = useMemo(() => {
    if (!selectedConversationId) return [] as InstagramMessage[];
    return allMessages
      .filter((m) => (m.sender_id ?? "unknown") === selectedConversationId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [allMessages, selectedConversationId]);

  const sendMessage = useCallback(
    async (params: {
      instagram_account_id: string;
      recipient_id: string;
      message: string;
      message_type?: "dm" | "comment";
      comment_id?: string;
    }) => {
      console.log("Enviando mensagem Instagram:", params);
      const { data, error: invokeError } = await supabase.functions.invoke("instagram-send-message", {
        body: params,
      });
      if (invokeError) {
        console.error("[ig-send] invoke error:", invokeError);
        throw invokeError;
      }
      if (data && (data as { error?: string }).error) {
        console.error("[ig-send] response error:", data);
        throw new Error((data as { error: string }).error);
      }
      return data;
    },
    [],
  );

  const markAsRead = useCallback(async (sender_id: string) => {
    const ids = allMessages
      .filter((m) => m.sender_id === sender_id && !m.is_outbound && !m.is_read)
      .map((m) => m.id);
    if (!ids.length) return;
    setAllMessages((prev) => prev.map((m) => (ids.includes(m.id) ? { ...m, is_read: true } : m)));
    await supabase.from("instagram_messages").update({ is_read: true }).in("id", ids);
  }, [allMessages]);

  return {
    conversations,
    messages,
    selectedConversationId,
    setSelectedConversationId,
    sendMessage,
    markAsRead,
    loading,
    error,
    refetch: fetchAll,
  };
}
