import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type LeadLabel = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  description: string | null;
};

export type LeadLabelAssignment = {
  id: string;
  lead_id: string;
  label_id: string;
};

export const LABEL_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#10b981", "#06b6d4", "#3b82f6", "#6366f1",
  "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#f43f5e",
  "#64748b", "#0ea5e9", "#14b8a6", "#dc2626", "#000000",
];

export function useLeadLabels() {
  const { user } = useAuth();
  const [labels, setLabels] = useState<LeadLabel[]>([]);
  const [assignments, setAssignments] = useState<LeadLabelAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) return;
    const [lblRes, asgRes] = await Promise.all([
      supabase.from("crm_user_labels").select("id, user_id, name, color, description").order("created_at"),
      supabase.from("crm_lead_label_assignments").select("id, lead_id, label_id"),
    ]);
    setLabels((lblRes.data as LeadLabel[]) || []);
    setAssignments((asgRes.data as LeadLabelAssignment[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { reload(); }, [reload]);

  const labelsByLead = useCallback((leadId: string): LeadLabel[] => {
    const lblMap = new Map(labels.map(l => [l.id, l]));
    return assignments
      .filter(a => a.lead_id === leadId)
      .map(a => lblMap.get(a.label_id))
      .filter((l): l is LeadLabel => !!l);
  }, [labels, assignments]);

  const createLabel = useCallback(async (payload: { name: string; color: string; description?: string }) => {
    if (!user) return null;
    const { data, error } = await supabase
      .from("crm_user_labels")
      .insert({ user_id: user.id, name: payload.name, color: payload.color, description: payload.description || null })
      .select("id, user_id, name, color, description")
      .single();
    if (!error && data) {
      setLabels(prev => [...prev, data as LeadLabel]);
      return data as LeadLabel;
    }
    return null;
  }, [user]);

  const updateLabel = useCallback(async (id: string, patch: Partial<Pick<LeadLabel, "name" | "color" | "description">>) => {
    const { error } = await supabase.from("crm_user_labels").update(patch).eq("id", id);
    if (!error) setLabels(prev => prev.map(l => l.id === id ? { ...l, ...patch } as LeadLabel : l));
  }, []);

  const deleteLabel = useCallback(async (id: string) => {
    const { error } = await supabase.from("crm_user_labels").delete().eq("id", id);
    if (!error) {
      setLabels(prev => prev.filter(l => l.id !== id));
      setAssignments(prev => prev.filter(a => a.label_id !== id));
    }
  }, []);

  const toggleAssignment = useCallback(async (leadId: string, labelId: string) => {
    if (!user) return;
    const existing = assignments.find(a => a.lead_id === leadId && a.label_id === labelId);
    if (existing) {
      const { error } = await supabase.from("crm_lead_label_assignments").delete().eq("id", existing.id);
      if (!error) setAssignments(prev => prev.filter(a => a.id !== existing.id));
    } else {
      const { data, error } = await supabase
        .from("crm_lead_label_assignments")
        .insert({ lead_id: leadId, label_id: labelId, created_by: user.id })
        .select("id, lead_id, label_id")
        .single();
      if (!error && data) setAssignments(prev => [...prev, data as LeadLabelAssignment]);
    }
  }, [user, assignments]);

  return { labels, assignments, loading, reload, labelsByLead, createLabel, updateLabel, deleteLabel, toggleAssignment };
}
