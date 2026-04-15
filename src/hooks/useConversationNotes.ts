import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ConvNote } from "@/components/chat/ConversationInlineNote";

export function useConversationNotes(leadId: string | null | undefined) {
  const [notes, setNotes] = useState<ConvNote[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!leadId) { setNotes([]); return; }
    const load = async () => {
      const { data } = await supabase
        .from("crm_conversation_notes")
        .select("id, lead_id, after_message_id, content, author_id, created_at")
        .eq("lead_id", leadId)
        .order("created_at");
      setNotes((data || []) as ConvNote[]);

      // Load author names
      const authorIds = [...new Set((data || []).map((n: any) => n.author_id).filter(Boolean))];
      if (authorIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, nome")
          .in("id", authorIds);
        const map: Record<string, string> = {};
        (profs || []).forEach((p: any) => { map[p.id] = p.nome; });
        setProfiles(map);
      }
    };
    load();
  }, [leadId]);

  const notesByMessageId = useCallback((msgId: string) => {
    return notes.filter((n) => n.after_message_id === msgId);
  }, [notes]);

  const addNote = useCallback((note: ConvNote) => {
    setNotes((prev) => [...prev, note]);
  }, []);

  const removeNote = useCallback((noteId: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  }, []);

  const updateNote = useCallback((noteId: string, content: string) => {
    setNotes((prev) => prev.map((n) => n.id === noteId ? { ...n, content } : n));
  }, []);

  return { notes, notesByMessageId, addNote, removeNote, updateNote, profiles };
}
