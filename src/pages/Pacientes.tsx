import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Eye, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { DateRangeFilter, type DateRangeFilterValue, getDateRangeFromFilter } from "@/components/ui/date-range-filter";

interface PacienteView {
  id: string;
  nome: string;
  telefone: string;
  cidade: string | null;
  created_at: string;
  valor_contratado: number;
  ultimo_valor_pago: number | null;
  ultima_visita: string | null;
  clinica_nome: string | null;
  is_recorrente: boolean;
}

const Pacientes = () => {
  const [busca, setBusca] = useState("");
  const [dateFilter, setDateFilter] = useState<DateRangeFilterValue>({ preset: "all" });
  const [pacientes, setPacientes] = useState<PacienteView[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);

      const [{ data: pacs }, { data: pagamentos }, { data: clinicas }] = await Promise.all([
        supabase.from("pacientes").select("id, nome, telefone, cidade, created_at").order("created_at", { ascending: false }),
        supabase.from("pagamentos").select("paciente_id, valor, data_pagamento, clinica_id, tipo").order("data_pagamento", { ascending: false }),
        supabase.from("clinicas").select("id, nome"),
      ]);

      if (!pacs) { setLoading(false); return; }

      const clinicaMap = new Map<string, string>();
      clinicas?.forEach((c) => clinicaMap.set(c.id, c.nome));

      // Hoje (local) — ignora pagamentos com data futura
      const hojeLocal = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      })();
      const pagamentosValidos = (pagamentos || []).filter((p: any) => !p.data_pagamento || p.data_pagamento <= hojeLocal);

      const contratadoMap = new Map<string, number>();
      pagamentosValidos.forEach((p: any) => {
        contratadoMap.set(p.paciente_id, (contratadoMap.get(p.paciente_id) || 0) + Number(p.valor || 0));
      });

      const pagMap = new Map<string, any[]>();
      pagamentosValidos.forEach((p: any) => {
        if (!pagMap.has(p.paciente_id)) pagMap.set(p.paciente_id, []);
        pagMap.get(p.paciente_id)!.push(p);
      });

      const toLocal = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };
      const range = getDateRangeFromFilter(dateFilter);
      const dataMinima = range ? toLocal(range.start) : null;
      const dataMaxima = range ? toLocal(range.end) : null;

      const result: PacienteView[] = [];
      const periodActive = !!(dataMinima || dataMaxima);
      for (const p of pacs) {
        const valorContratadoTotal = contratadoMap.get(p.id) || 0;
        let pags = pagMap.get(p.id) || [];

        if (periodActive) {
          pags = pags.filter((pg: any) => {
            if (dataMinima && pg.data_pagamento < dataMinima) return false;
            if (dataMaxima && pg.data_pagamento > dataMaxima) return false;
            return true;
          });
          if (pags.length === 0) continue;
        }

        const valorContratado = periodActive
          ? pags.reduce((s: number, pg: any) => s + Number(pg.valor || 0), 0)
          : valorContratadoTotal;
        // pags[0] é o pagamento mais recente porque o select já ordena por data_pagamento DESC
        const ultimaVisita = pags[0]?.data_pagamento || null;
        const ultimoValorPago = pags[0]?.valor != null ? Number(pags[0].valor) : null;
        const clinicaNome = pags[0]?.clinica_id ? clinicaMap.get(pags[0].clinica_id) || null : null;
        const isRecorrente = (pagMap.get(p.id) || []).some((pg: any) => pg.tipo === "recorrente");

        result.push({
          ...p,
          valor_contratado: valorContratado,
          ultimo_valor_pago: ultimoValorPago,
          ultima_visita: ultimaVisita,
          clinica_nome: clinicaNome,
          is_recorrente: isRecorrente,
        });
      }

      result.sort((a, b) => {
        if (a.ultima_visita && b.ultima_visita) return b.ultima_visita.localeCompare(a.ultima_visita);
        if (a.ultima_visita) return -1;
        if (b.ultima_visita) return 1;
        return 0;
      });

      setPacientes(result);
      setLoading(false);
    };
    fetchAll();
  }, [dateFilter]);

  const filtered = useMemo(() => {
    return pacientes.filter(
      (p) =>
        p.nome.toLowerCase().includes(busca.toLowerCase()) ||
        p.telefone.includes(busca)
    );
  }, [pacientes, busca]);

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pacientes</h1>
          <p className="text-sm text-muted-foreground">{pacientes.length} pacientes cadastrados</p>
        </div>
        <Button
          onClick={() => navigate("/atendimento")}
          className="gradient-orange text-primary-foreground shadow-orange hover:opacity-90 transition-opacity"
        >
          <Plus size={18} className="mr-2" />
          Novo Atendimento
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="relative flex-1 space-y-1">
          <span className="text-xs text-muted-foreground">Busca</span>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou telefone..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="bg-secondary border-border pl-10"
            />
          </div>
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Período</span>
          <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
        </div>
      </div>

      {loading ? (
        <div className="text-center text-muted-foreground animate-pulse py-12">Carregando pacientes...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">Nenhum paciente encontrado.</div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((pac) => (
            <Card key={pac.id} className="gradient-card border-border shadow-card hover:border-primary/30 transition-colors">
              <CardContent className="flex items-center justify-between p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold">{pac.nome}</p>
                    {pac.is_recorrente ? (
                      <Badge className="bg-blue-600/20 text-blue-400 border-blue-600/30 text-xs">Recorrente</Badge>
                    ) : (
                      <Badge className="bg-orange-600/20 text-orange-400 border-orange-600/30 text-xs">Cliente novo</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {pac.telefone} {pac.clinica_nome && `• ${pac.clinica_nome}`}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right space-y-0.5">
                    <p className="text-sm font-semibold text-primary">
                      Contratado: R$ {pac.valor_contratado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </p>
                    {pac.ultimo_valor_pago != null && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">
                        Último pagamento: R$ {pac.ultimo_valor_pago.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </p>
                    )}
                    {pac.ultima_visita && (
                      <p className="text-xs text-muted-foreground">
                        Última visita: {new Date(pac.ultima_visita + "T12:00:00").toLocaleDateString("pt-BR")}
                      </p>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" onClick={() => navigate(`/pacientes/${pac.id}`)}>
                    <Eye size={18} />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default Pacientes;
