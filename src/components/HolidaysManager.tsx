import { useState, useEffect } from "react";
import { CalendarOff, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";

interface Props {
  clinicas: Tables<"clinicas">[];
  onChange?: () => void;
}

export interface Holiday {
  id: string;
  data: string;
  descricao: string | null;
  clinica_id: string | null;
}

export const HolidaysManager = ({ clinicas, onChange }: Props) => {
  const [open, setOpen] = useState(false);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [data, setData] = useState("");
  const [descricao, setDescricao] = useState("");
  const [clinicaId, setClinicaId] = useState<string>("todas");
  const { toast } = useToast();

  const load = async () => {
    const { data: rows } = await (supabase as any)
      .from("dashboard_holidays")
      .select("id, data, descricao, clinica_id")
      .order("data", { ascending: false });
    setHolidays((rows || []) as Holiday[]);
  };

  useEffect(() => { if (open) load(); }, [open]);

  const add = async () => {
    if (!data) {
      toast({ title: "Informe a data", variant: "destructive" });
      return;
    }
    const { error } = await (supabase as any).from("dashboard_holidays").insert({
      data,
      descricao: descricao || null,
      clinica_id: clinicaId === "todas" ? null : clinicaId,
    });
    if (error) {
      toast({ title: "Erro ao adicionar", description: error.message, variant: "destructive" });
      return;
    }
    setData("");
    setDescricao("");
    setClinicaId("todas");
    await load();
    onChange?.();
    toast({ title: "Feriado adicionado" });
  };

  const remove = async (id: string) => {
    // Delete barrado pela RLS não devolve erro — devolve sucesso com ZERO
    // linhas. O `.select()` torna a resposta verificável; sem ele o feriado
    // reaparecia na lista sem explicação.
    const { data: removed, error } = await (supabase as any)
      .from("dashboard_holidays")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) {
      toast({ title: "Erro ao remover", description: error.message, variant: "destructive" });
      return;
    }
    if (!removed || removed.length === 0) {
      toast({
        title: "Sem permissão",
        description: "Seu perfil não tem permissão para remover feriados.",
        variant: "destructive",
      });
      return;
    }
    await load();
    onChange?.();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-10 gap-2 rounded-xl bg-card px-3.5 text-[13px] font-medium shadow-xs">
          <CalendarOff className="h-4 w-4 shrink-0 text-primary" />
          Feriados
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg gap-5 rounded-2xl p-5 sm:p-6">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-lg font-semibold leading-snug tracking-tight">Feriados / Dias sem faturamento</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-3 rounded-xl border border-border/60 bg-surface-sunken/50 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label className="text-[13px] font-semibold text-foreground">Data</Label>
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} className="h-10 rounded-xl bg-card font-medium tabular-nums" />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label className="text-[13px] font-semibold text-foreground">Clínica (opcional)</Label>
              <Select value={clinicaId} onValueChange={setClinicaId}>
                <SelectTrigger className="h-10 rounded-xl bg-card font-medium"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as clínicas</SelectItem>
                  {clinicas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px] font-semibold text-foreground">Descrição (opcional)</Label>
            <Input placeholder="Ex: Sexta-feira Santa" value={descricao} onChange={(e) => setDescricao(e.target.value)} className="h-10 rounded-xl bg-card" />
          </div>
          <Button onClick={add} className="h-10 w-full gap-2 rounded-xl font-semibold"><Plus className="h-4 w-4" />Adicionar feriado</Button>
          </div>

          <div className="border-t border-border/60 pt-4">
            <p className="mb-2.5 text-[11px] font-semibold tracking-wider text-tertiary">FERIADOS CADASTRADOS</p>
            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {holidays.length === 0 && (
                <p className="rounded-xl bg-surface-sunken/60 py-6 text-center text-sm text-muted-foreground">Nenhum feriado cadastrado</p>
              )}
              {holidays.map((h) => {
                const cl = clinicas.find((c) => c.id === h.clinica_id);
                const [y, m, d] = h.data.split("-");
                return (
                  <div key={h.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-sunken px-3.5 py-2.5 transition-colors hover:bg-muted">
                    <div className="min-w-0 text-sm leading-relaxed">
                      <span className="inline-flex h-6 items-center rounded-full bg-slate-soft px-2.5 text-xs font-semibold tabular-nums text-slate-soft-foreground">{`${d}/${m}/${y}`}</span>
                      {h.descricao && <span className="font-medium text-foreground"> — {h.descricao}</span>}
                      <span className="mt-0.5 block text-xs text-tertiary">
                        {cl ? cl.nome : "Todas as clínicas"}
                      </span>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => remove(h.id)} className="h-8 w-8 shrink-0 rounded-lg p-0 hover:bg-destructive-soft">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
