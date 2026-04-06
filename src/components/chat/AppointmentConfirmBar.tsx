import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, CalendarCheck, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Task = {
  id: string;
  title: string;
  due_date: string;
  type: string;
  status: string;
  notes: string | null;
};

export default function AppointmentConfirmBar({ leadId }: { leadId: string }) {
  const [pendingTasks, setPendingTasks] = useState<Task[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<Task | null>(null);
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState("09:00");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from("crm_tasks")
        .select("id, title, due_date, type, status, notes")
        .eq("lead_id", leadId)
        .eq("type", "agendamento")
        .eq("status", "pending")
        .order("due_date");
      setPendingTasks((data as Task[]) || []);
    };
    fetch();
  }, [leadId]);

  const handleConfirm = async () => {
    if (!confirmDialog || !date) {
      toast.error("Selecione a data do agendamento");
      return;
    }
    setSaving(true);

    const { data: session } = await supabase.auth.getSession();
    const userId = session?.session?.user?.id;

    // Create appointment
    const { error: apptError } = await supabase.from("crm_appointments").insert({
      lead_id: leadId,
      task_id: confirmDialog.id,
      scheduled_date: format(date, "yyyy-MM-dd"),
      scheduled_time: time,
      status: "confirmed",
      notes: confirmDialog.notes,
      confirmed_by: userId || null,
      confirmed_at: new Date().toISOString(),
    });

    if (apptError) {
      toast.error("Erro ao criar agendamento");
      setSaving(false);
      return;
    }

    // Mark task as done
    await supabase.from("crm_tasks").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", confirmDialog.id);

    // Insert system message
    await supabase.from("messages").insert({
      lead_id: leadId,
      direction: "outbound",
      type: "system",
      content: `✅ Agendamento confirmado: ${format(date, "dd/MM/yyyy")} às ${time}`,
      status: "system",
    });

    toast.success("Agendamento confirmado!");
    setPendingTasks(prev => prev.filter(t => t.id !== confirmDialog.id));
    setConfirmDialog(null);
    setDate(undefined);
    setTime("09:00");
    setSaving(false);
  };

  if (pendingTasks.length === 0) return null;

  return (
    <>
      <div className="px-4 py-2 bg-orange-500/10 border-b border-orange-500/20 flex items-center gap-3">
        <CalendarCheck size={16} className="text-orange-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-orange-700">
            {pendingTasks.length} agendamento(s) aguardando confirmação
          </p>
        </div>
        {pendingTasks.map(task => (
          <Button
            key={task.id}
            size="sm"
            className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700 text-white shrink-0"
            onClick={() => {
              setConfirmDialog(task);
              const d = new Date(task.due_date);
              setDate(d);
              setTime(format(d, "HH:mm"));
            }}
          >
            <CheckCircle2 size={12} /> Confirmar
          </Button>
        ))}
      </div>

      <Dialog open={!!confirmDialog} onOpenChange={(o) => { if (!o) setConfirmDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirmar Agendamento</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{confirmDialog?.title}</p>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Data do agendamento</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("h-9 text-sm w-full justify-start", !date && "text-muted-foreground")}>
                    <CalendarIcon size={14} className="mr-2" />
                    {date ? format(date, "dd/MM/yyyy") : "Selecionar data"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={date} onSelect={setDate} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Horário</label>
              <Input type="time" value={time} onChange={e => setTime(e.target.value)} className="h-9" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>Cancelar</Button>
            <Button onClick={handleConfirm} disabled={saving} className="bg-green-600 hover:bg-green-700">
              {saving ? "Confirmando..." : "Confirmar Agendamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
