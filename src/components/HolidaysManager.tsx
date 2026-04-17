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
    const { error } = await (supabase as any).from("dashboard_holidays").delete().eq("id", id);
    if (error) {
      toast({ title: "Erro ao remover", description: error.message, variant: "destructive" });
      return;
    }
    await load();
    onChange?.();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <CalendarOff className="h-4 w-4" />
          Feriados
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Feriados / Dias sem faturamento</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Data</Label>
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Clínica (opcional)</Label>
              <Select value={clinicaId} onValueChange={setClinicaId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as clínicas</SelectItem>
                  {clinicas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Descrição (opcional)</Label>
            <Input placeholder="Ex: Sexta-feira Santa" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <Button onClick={add} className="w-full gap-2"><Plus className="h-4 w-4" />Adicionar feriado</Button>

          <div className="border-t pt-3">
            <p className="text-xs font-semibold text-muted-foreground mb-2">FERIADOS CADASTRADOS</p>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {holidays.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhum feriado cadastrado</p>
              )}
              {holidays.map((h) => {
                const cl = clinicas.find((c) => c.id === h.clinica_id);
                const [y, m, d] = h.data.split("-");
                return (
                  <div key={h.id} className="flex items-center justify-between gap-2 p-2 rounded hover:bg-muted/50">
                    <div className="text-sm">
                      <span className="font-medium">{`${d}/${m}/${y}`}</span>
                      {h.descricao && <span className="text-muted-foreground"> — {h.descricao}</span>}
                      <span className="text-xs text-muted-foreground block">
                        {cl ? cl.nome : "Todas as clínicas"}
                      </span>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => remove(h.id)}>
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
