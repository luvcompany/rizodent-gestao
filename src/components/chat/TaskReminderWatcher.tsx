import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const ALERT_SOUND_URL = "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVYGAACAgICAgICAgICAgICAgICAgICAgICAgHx8fHx8gICAgICEhISEhISEhISEhISIiIiIiIiIiIiIjIyMjIyMjIyMjIyQkJCQkJCQkJCQlJSUlJSUlJSUlJiYmJiYmJiYmJicnJycnJycnJycnKCgoKCgoKCgoKCkpKSkpKSkpKSkqKioqKioqKioqKysrKysrKysrKywsLCwsLCwsLCwtLS0tLS0tLS0tLi4uLi4uLi4uLi8vLy8vLy8vLy8wMDAwMDAwMDAwMTExMTExMTExMTIyMjIyMjIyMjIzMzMzMzMzMzMzNDQ0NDQ0NDQ0NDU1NTU1NTU1NTU2NjY2NjY2NjY2Nzc3Nzc3Nzc3Nzg4ODg4ODg4ODg5OTk5OTk5OTk5Ojo6Ojo6Ojo6Ojs7Ozs7Ozs7Ozs8PDw8PDw8PDw8PT09PT09PT09PT4+Pj4+Pj4+Pj4/Pz8/Pz8/Pz8/QEBAQEBAQEBAQEFBQUFBQUFBQUFCQkJCQkJCQkJCQ0NDQ0NDQ0NDQ0REREREREREREVFRUVFRUVFRUVGRkZGRkZGRkZGR0dHR0dHR0dHR0hISEhISEhISElJSUlJSUlJSUlKSkpKSkpKSkpKS0tLS0tLS0tLTExMTExMTExMTE1NTU1NTU1NTU5OTk5OTk5OTk9PT09PT09PT1BQUFBQUFBQUFBQUFBQUFBQUFBQUE9PT09PT09PTk5OTk5OTk5OTExMTExMTExMS0tLS0tLS0tLSkpKSkpKSkpKSUlJSUlJSUlJSEhISEhISEhIR0dHR0dHR0dHRkZGRkZGRkZGRUVFRUVFRUVFREREREREREREQ0NDQ0NDQ0NDQkJCQkJCQkJCQUFBQUFBQUFBQEBAQEBAQEBAQD8/Pz8/Pz8/Pz4+Pj4+Pj4+Pj09PT09PT09PT08PDw8PDw8PDw7Ozs7Ozs7Ozs6Ojo6Ojo6Ojo5OTk5OTk5OTk4ODg4ODg4ODg3Nzc3Nzc3Nzc2NjY2NjY2NjY1NTU1NTU1NTU0NDQ0NDQ0NDQzMzMzMzMzMzMyMjIyMjIyMjIxMTExMTExMTEwMDAwMDAwMDAvLy8vLy8vLy8uLi4uLi4uLi4tLS0tLS0tLS0sLCwsLCwsLCwrKysrKysrKysqKioqKioqKioqKSkpKSkpKSkpKCgoKCgoKCgoJycnJycnJycnJiYmJiYmJiYmJSUlJSUlJSUlJCQkJCQkJCQkIyMjIyMjIyMjIiIiIiIiIiIiISEhISEhISEhICAgICAgICAggB8fHx8fHx8fHx4eHh4eHh4eHh0dHR0dHR0dHRwcHBwcHBwcHBsbGxsbGxsbGxoaGhoaGhoaGhkZGRkZGRkZGRgYGBgYGBgYGBcXFxcXFxcXFxYWFhYWFhYWFhUVFRUVFRUVFRQUFBQUFBQUFBMTExMTExMTExISEhISEhISEhERERERERERERAQEBAQEBAQEA8PDw8PDw8PDw4ODg4ODg4ODg0NDQ0NDQ0NDQwMDAwMDAwMDAsMDAwMDAwMDAwNDQ0NDQ0NDQ0ODg4ODg4ODg4PDw8PDw8PDw8QEBAQEBAQEBARERERERERERESERISERISERISERISERISERISERISERISERISERISERISERQ0NDQ0NDQ0NDFBQUFBQUFBQUFBUVFRUVFRUVFRYUFBQUFBQUFBUXFRUV";

function playAlertSound() {
  try {
    const audio = new Audio(ALERT_SOUND_URL);
    audio.volume = 0.5;
    audio.play().catch(() => {});
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
