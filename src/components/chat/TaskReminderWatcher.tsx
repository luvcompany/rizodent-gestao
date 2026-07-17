import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";


function playAlertSound() {
  try {
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!AC) return;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);

    const now = ctx.currentTime;
    // Chime suave "ding-dong" — duas notas em senoide
    const notes: Array<{ freq: number; start: number; dur: number }> = [
      { freq: 880, start: 0.0, dur: 0.45 },
      { freq: 659.25, start: 0.28, dur: 0.65 },
    ];

    notes.forEach(({ freq, start, dur }) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(g);
      g.connect(master);
      const t0 = now + start;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    });

    setTimeout(() => { try { ctx.close(); } catch {} }, 1500);
  } catch {}
}

const CHECK_INTERVAL = 60_000; // check every 1 minute
const REMINDER_MINUTES = 15; // alert 15 min before

const TaskReminderWatcher = () => {
  const { user } = useAuth();
  const alertedIdsRef = useRef<Set<string>>(new Set());

  const checkUpcoming = useCallback(async () => {
    if (!user?.id) return;

    const now = new Date();
    const threshold = new Date(now.getTime() + REMINDER_MINUTES * 60_000);

    // Check tasks
    const { data: tasks } = await supabase
      .from("crm_tasks")
      .select("id, title, due_date, lead_id, crm_leads(name)")
      .eq("status", "pending")
      .or(`assigned_to.eq.${user.id},assigned_to.is.null`)
      .gte("due_date", now.toISOString())
      .lte("due_date", threshold.toISOString())
      .limit(10);

    // Check appointments
    const todayStr = now.toISOString().slice(0, 10);
    const { data: appointments } = await supabase
      .from("crm_appointments")
      .select("id, scheduled_date, scheduled_time, lead_id, crm_leads(name)")
      .eq("status", "confirmed")
      .eq("scheduled_date", todayStr)
      .limit(20);

    // Process tasks
    (tasks || []).forEach((task: any) => {
      if (alertedIdsRef.current.has(`task-${task.id}`)) return;
      alertedIdsRef.current.add(`task-${task.id}`);

      const leadName = task.crm_leads?.name || "Lead";
      playAlertSound();
      toast.warning(`⏰ Tarefa próxima: ${task.title}`, {
        description: `${leadName} — em ${Math.ceil((new Date(task.due_date).getTime() - now.getTime()) / 60_000)} min`,
        duration: 15000,
      });
    });

    // Process appointments
    (appointments || []).forEach((appt: any) => {
      if (alertedIdsRef.current.has(`appt-${appt.id}`)) return;

      const [h, m] = (appt.scheduled_time || "00:00").split(":").map(Number);
      const apptTime = new Date(appt.scheduled_date);
      apptTime.setHours(h, m, 0, 0);

      const diff = apptTime.getTime() - now.getTime();
      if (diff < 0 || diff > REMINDER_MINUTES * 60_000) return;

      alertedIdsRef.current.add(`appt-${appt.id}`);

      const leadName = appt.crm_leads?.name || "Lead";
      playAlertSound();
      toast.warning(`📅 Agendamento em ${Math.ceil(diff / 60_000)} min`, {
        description: `${leadName} — ${appt.scheduled_time}`,
        duration: 15000,
      });
    });
  }, [user?.id]);

  useEffect(() => {
    checkUpcoming();
    const interval = setInterval(checkUpcoming, CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, [checkUpcoming]);

  return null;
};

export default TaskReminderWatcher;
