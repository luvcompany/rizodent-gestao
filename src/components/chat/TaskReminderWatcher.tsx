import { useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { hojeNoFusoDaClinica, minutosParaAviso } from "@/lib/horaDaConsulta";
import { avisarNoNavegador } from "@/lib/notificacoesNavegador";

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
  const navigate = useNavigate();
  // Em ref: o intervalo não pode ser refeito a cada troca de rota.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const alertedIdsRef = useRef<Set<string>>(new Set());

  const checkUpcoming = useCallback(async () => {
    if (!user?.id) return;
    const userId = user.id;

    const now = new Date();
    const threshold = new Date(now.getTime() + REMINDER_MINUTES * 60_000);

    // Tarefas: só as do PRÓPRIO usuário — o mesmo critério do contador do menu
    // Calendário (CrmLayout, assigned_to = eu). Antes o lembrete tocava também
    // para as tarefas sem responsável que o contador não mostrava (X-16); o
    // painel de tarefas agora já nasce com o usuário logado como Responsável.
    const { data: tasks, error: tasksErr } = await supabase
      .from("crm_tasks")
      .select("id, title, due_date, lead_id, crm_leads(name)")
      .eq("status", "pending")
      .eq("assigned_to", userId)
      .gte("due_date", now.toISOString())
      .lte("due_date", threshold.toISOString())
      .limit(10);

    // Consultas de HOJE no fuso da clínica (X-1): toISOString() dava o dia UTC,
    // e das 21:00 às 23:59 a busca pegava o dia seguinte.
    const todayStr = hojeNoFusoDaClinica(now);
    // Consultas de leads do PRÓPRIO usuário ou sem responsável (a fila da
    // clínica, que alguém tem de receber). O !inner garante que o filtro no
    // lead realmente restringe as linhas — e a RLS do lead já limita ao mundo
    // do número acessível.
    // O .or vai COM referencedTable: coluna do recurso embutido dentro do or=
    // da raiz ("crm_leads.assigned_to.eq…") o PostgREST não aceita (400
    // PGRST100) — e, como o erro era ignorado, o alerta nunca disparava.
    const { data: appointments, error: apptErr } = await supabase
      .from("crm_appointments")
      .select("id, scheduled_date, scheduled_time, lead_id, crm_leads!inner(name, assigned_to)")
      .eq("status", "confirmed")
      .eq("scheduled_date", todayStr)
      .or(`assigned_to.eq.${userId},assigned_to.is.null`, { referencedTable: "crm_leads" })
      .limit(20);

    // Erro de consulta não pode sumir calado (foi assim que o 400 acima passou).
    if (tasksErr) console.error("[TaskReminderWatcher] tarefas:", tasksErr.message);
    if (apptErr) console.error("[TaskReminderWatcher] agendamentos:", apptErr.message);

    // Process tasks
    (tasks || []).forEach((task: any) => {
      if (alertedIdsRef.current.has(`task-${task.id}`)) return;
      alertedIdsRef.current.add(`task-${task.id}`);

      const leadName = task.crm_leads?.name || "Lead";
      const faltam = Math.ceil((new Date(task.due_date).getTime() - now.getTime()) / 60_000);
      playAlertSound();
      toast.warning(`⏰ Tarefa próxima: ${task.title}`, {
        description: `${leadName} — em ${faltam} min`,
        duration: 15000,
      });
      // Notificação do navegador, se o usuário ligou "tarefa vencendo" (INTEG-4).
      void avisarNoNavegador(userId, "tarefa", {
        titulo: `Tarefa em ${faltam} min: ${task.title}`,
        corpo: leadName,
        tag: `crm-tarefa-${task.id}`,
        aoClicar: task.lead_id ? () => navigateRef.current(`/crm/conversa/${task.lead_id}`) : undefined,
      });
    });

    // Process appointments
    (appointments || []).forEach((appt: any) => {
      // Chave com data e hora: consulta remarcada para mais tarde avisa de novo.
      const chave = `appt-${appt.id}-${appt.scheduled_date}-${appt.scheduled_time}`;
      if (alertedIdsRef.current.has(chave)) return;

      // Instante da consulta no fuso da clínica, pela data e hora quebradas em
      // números (X-1) — new Date("AAAA-MM-DD") + setHours caía no dia anterior.
      const faltam = minutosParaAviso(appt.scheduled_date, appt.scheduled_time, now.getTime(), REMINDER_MINUTES);
      if (faltam === null) return;

      alertedIdsRef.current.add(chave);

      const leadName = appt.crm_leads?.name || "Lead";
      const hora = String(appt.scheduled_time || "").slice(0, 5);
      playAlertSound();
      toast.warning(`📅 Agendamento em ${faltam} min`, {
        description: `${leadName} — ${hora}`,
        duration: 15000,
      });
      void avisarNoNavegador(userId, "tarefa", {
        titulo: `Agendamento em ${faltam} min`,
        corpo: `${leadName} — ${hora}`,
        tag: `crm-consulta-${appt.id}`,
        aoClicar: appt.lead_id ? () => navigateRef.current(`/crm/conversa/${appt.lead_id}`) : undefined,
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
