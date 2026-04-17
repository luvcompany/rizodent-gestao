import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { DollarSign, Plus, ExternalLink, Search, UserPlus, MapPin } from "lucide-react";

const CIDADES = ["Vitória da Conquista", "Guanambi", "Ipiaú", "Itabuna"];
const EMPTY_CITY_VALUE = "none";

type Lead = {
  id: string;
  name: string;
  phone: string | null;
  paciente_id: string | null;
  value: number | null;
  cidade?: string | null;
};

type Paciente = {
  id: string;
  nome: string;
  telefone: string;
  email: string | null;
  cidade: string | null;
};

type OrcamentoComPago = {
  id: string;
  valor_orcado: number;
  valor_pago: number;
  status: string;
  created_at: string;
};

type Props = {
  lead: Lead;
  onLeadUpdated: (updates: Partial<Lead>) => void;
};

export default function LeadBudgetPanel({ lead, onLeadUpdated }: Props) {
  const navigate = useNavigate();
  const autoLinkAttemptedRef = useRef<Set<string>>(new Set());
  const [paciente, setPaciente] = useState<Paciente | null>(null);
  const [orcamentos, setOrcamentos] = useState<OrcamentoComPago[]>([]);
  const [totalPaid, setTotalPaid] = useState(0);
  const [totalBudgeted, setTotalBudgeted] = useState(0);
  const [cidade, setCidade] = useState(lead.cidade || EMPTY_CITY_VALUE);
  const [linkOpen, setLinkOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<Paciente[]>([]);
  const [searching, setSearching] = useState(false);
  const [savingCity, setSavingCity] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicates, setDuplicates] = useState<Paciente[]>([]);

  useEffect(() => {
    setCidade(lead.cidade || EMPTY_CITY_VALUE);
  }, [lead.id, lead.cidade]);

  useEffect(() => {
    if (lead.paciente_id) {
      fetchPacienteAndBudgets(lead.paciente_id);
    } else {
      setPaciente(null);
      setOrcamentos([]);
      setTotalPaid(0);
      setTotalBudgeted(0);
      // Auto-link by phone signature (last 8 digits) — only once per lead per session
      if (!autoLinkAttemptedRef.current.has(lead.id)) {
        autoLinkAttemptedRef.current.add(lead.id);
        void autoLinkByPhone();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.paciente_id]);

  const autoLinkByPhone = async () => {
    const phoneClean = (lead.phone || "").replace(/\D/g, "");
    if (phoneClean.length < 8) return;
    const tail = phoneClean.slice(-8);
    const pattern = "%" + tail.split("").join("%") + "%";
    const { data } = await supabase
      .from("pacientes")
      .select("id, nome, telefone, email, cidade")
      .ilike("telefone", pattern)
      .limit(5);
    if (!data || data.length === 0) return;
    if (data.length === 1) {
      // Single match → auto-link
      const { error, data: upd } = await supabase
        .from("crm_leads")
        .update({ paciente_id: data[0].id })
        .eq("id", lead.id)
        .select("id");
      if (error) {
        toast.error(`Não foi possível vincular automaticamente: ${error.message}`);
        return;
      }
      if (!upd || upd.length === 0) {
        toast.error("Sem permissão para vincular este lead.");
        return;
      }
      onLeadUpdated({ paciente_id: data[0].id });
      // Silent auto-link — no toast to avoid noise on every conversation open
    } else {
      // Multiple → just preload list and open dialog hint
      setSearchResults(data);
    }
  };

  const fetchPacienteAndBudgets = async (pacienteId: string) => {
    const [pRes, oRes, pagRes] = await Promise.all([
      supabase.from("pacientes").select("id, nome, telefone, email, cidade").eq("id", pacienteId).single(),
      supabase.from("orcamentos").select("id, valor_orcado, status, created_at").eq("paciente_id", pacienteId),
      supabase.from("pagamentos").select("valor, orcamento_id").eq("paciente_id", pacienteId),
    ]);

    if (pRes.data) {
      setPaciente(pRes.data);
    }

    const payments = pagRes.data || [];
    const paid = payments.reduce((sum, p) => sum + Number(p.valor), 0);
    setTotalPaid(paid);

    if (oRes.data) {
      const withPago = oRes.data.map(o => {
        const oPaid = payments.filter(p => p.orcamento_id === o.id).reduce((s, p) => s + Number(p.valor), 0);
        return { ...o, valor_pago: oPaid };
      });
      setOrcamentos(withPago);
      setTotalBudgeted(oRes.data.reduce((sum, o) => sum + Number(o.valor_orcado), 0));
    }

    // Sync lead value with total payments
    if (paid !== (lead.value || 0)) {
      await supabase.from("crm_leads").update({ value: paid }).eq("id", lead.id);
      onLeadUpdated({ value: paid });
    }
  };

  const handleCidadeChange = async (val: string) => {
    const normalizedCity = val === EMPTY_CITY_VALUE ? null : val;
    const previousCity = cidade;

    setCidade(val);
    onLeadUpdated({ cidade: normalizedCity });
    setSavingCity(true);

    const [leadRes, pacienteRes] = await Promise.all([
      supabase
        .from("crm_leads")
        .update({ cidade: normalizedCity, updated_at: new Date().toISOString() })
        .eq("id", lead.id),
      lead.paciente_id
        ? supabase.from("pacientes").update({ cidade: normalizedCity }).eq("id", lead.paciente_id)
        : Promise.resolve({ error: null }),
    ]);

    setSavingCity(false);

    if (leadRes.error || pacienteRes.error) {
      const rollbackCity = previousCity === EMPTY_CITY_VALUE ? null : previousCity;
      setCidade(previousCity);
      onLeadUpdated({ cidade: rollbackCity });
      toast.error("Erro ao salvar cidade");
    }
  };

  const handleSearch = async () => {
    if (!searchTerm.trim()) return;
    setSearching(true);
    const cleanSearch = searchTerm.replace(/\D/g, "");
    const isPhoneSearch = cleanSearch.length >= 4;

    let query = supabase.from("pacientes").select("id, nome, telefone, email, cidade").limit(20);

    if (isPhoneSearch) {
      // Use os últimos 8 dígitos como assinatura — independente de 55, DDD ou 9 extra
      const tail = cleanSearch.slice(-8);
      // Inserir wildcards entre dígitos para casar telefones com máscara: (77) 98805-816
      const pattern = "%" + tail.split("").join("%") + "%";
      query = query.or(`telefone.ilike.${pattern},nome.ilike.%${searchTerm}%`);
    } else {
      query = query.or(`nome.ilike.%${searchTerm}%,telefone.ilike.%${searchTerm}%`);
    }

    const { data } = await query;
    setSearchResults(data || []);
    setSearching(false);
  };

  const linkPaciente = async (pacienteId: string) => {
    const { error, data } = await supabase
      .from("crm_leads")
      .update({ paciente_id: pacienteId })
      .eq("id", lead.id)
      .select("id");
    if (error) { toast.error(`Erro ao vincular paciente: ${error.message}`); return; }
    if (!data || data.length === 0) {
      toast.error("Sem permissão para atualizar este lead. Contate o administrador.");
      return;
    }
    onLeadUpdated({ paciente_id: pacienteId });
    setLinkOpen(false);
    toast.success("Paciente vinculado ao lead");
  };

  const stripCountryCode = (phone: string) => {
    let clean = phone.replace(/\D/g, "");
    if (clean.startsWith("55") && clean.length >= 12) clean = clean.slice(2);
    return clean;
  };

  const createAndLinkPaciente = async (force = false) => {
    const normalizedCity = cidade === EMPTY_CITY_VALUE ? null : cidade;
    const phoneClean = stripCountryCode(lead.phone || "").replace(/\D/g, "");

    // Verificar duplicidade pelos últimos 8 dígitos antes de criar
    if (!force && phoneClean.length >= 8) {
      const tail = phoneClean.slice(-8);
      const pattern = "%" + tail.split("").join("%") + "%";
      const { data: existing } = await supabase
        .from("pacientes")
        .select("id, nome, telefone, email, cidade")
        .ilike("telefone", pattern)
        .limit(5);
      if (existing && existing.length > 0) {
        setDuplicates(existing);
        setDuplicateOpen(true);
        return;
      }
    }

    const { data, error } = await supabase.from("pacientes").insert({
      nome: lead.name,
      telefone: stripCountryCode(lead.phone || ""),
      cidade: normalizedCity,
    }).select("id").single();
    if (error || !data) { toast.error("Erro ao criar paciente"); return; }

    // Link lead to patient
    await supabase
      .from("crm_leads")
      .update({ paciente_id: data.id, cidade: normalizedCity, updated_at: new Date().toISOString() })
      .eq("id", lead.id);
    onLeadUpdated({ paciente_id: data.id, cidade: normalizedCity });
    setLinkOpen(false);
    setDuplicateOpen(false);
    toast.success("Paciente criado e vinculado!");

    // Navigate to atendimento page with new patient data
    navigate("/atendimento", {
      state: {
        pacienteId: data.id,
        pacienteNome: lead.name,
        pacienteTelefone: stripCountryCode(lead.phone || ""),
      },
    });
  };

  const linkExistingFromDuplicate = async (pacienteId: string) => {
    setDuplicateOpen(false);
    await linkPaciente(pacienteId);
  };

  const goToAtendimento = () => {
    navigate("/atendimento", {
      state: {
        pacienteId: lead.paciente_id,
        pacienteNome: paciente?.nome,
        pacienteTelefone: paciente?.telefone,
      },
    });
  };

  const formatCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="p-4 border-b border-border">
      <div className="flex items-center gap-2 mb-2">
        <DollarSign size={14} className="text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase">Orçamento & Valor</span>
      </div>

      {/* City selector - always visible */}
      <div className="mb-3">
        <div className="flex items-center gap-1 mb-1">
          <MapPin size={12} className="text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Cidade</span>
        </div>
        <select
          value={cidade}
          onChange={(e) => void handleCidadeChange(e.target.value)}
          disabled={savingCity}
          className="flex h-8 w-full rounded-md border border-input bg-secondary px-3 py-1 text-xs text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value={EMPTY_CITY_VALUE}>Sem localização</option>
          {CIDADES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {lead.paciente_id && paciente ? (
        <div className="space-y-2">
          <div className="p-2 bg-secondary/50 rounded text-sm">
            <p className="font-medium text-foreground">{paciente.nome}</p>
            <p className="text-xs text-muted-foreground">{paciente.telefone}</p>
          </div>

          {/* Payment totals */}
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground">Valor Contratado (pago)</span>
              <p className="text-primary font-bold text-lg">{formatCurrency(totalPaid)}</p>
            </div>
            <div className="text-right">
              <span className="text-xs text-muted-foreground">Orçado</span>
              <p className="text-sm text-muted-foreground">{formatCurrency(totalBudgeted)}</p>
            </div>
          </div>

          {/* Budget list with contracted values */}
          {orcamentos.length > 0 && (
            <div className="space-y-1">
              {orcamentos.map(o => (
                <div key={o.id} className="flex items-center justify-between text-xs p-1.5 bg-muted/30 rounded">
                  <span className="text-muted-foreground">
                    Orç. {formatCurrency(o.valor_orcado)}
                  </span>
                  <span className={o.valor_pago > 0 ? "text-primary font-medium" : "text-muted-foreground"}>
                    Pago: {formatCurrency(o.valor_pago)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <Button size="sm" variant="outline" className="w-full" onClick={goToAtendimento}>
            <Plus size={14} className="mr-1" /> Novo Orçamento / Atendimento
            <ExternalLink size={12} className="ml-auto" />
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Nenhum paciente vinculado</p>
          <Button size="sm" variant="outline" className="w-full" onClick={() => { setLinkOpen(true); setSearchTerm(stripCountryCode(lead.phone || "") || lead.name); setSearchResults([]); }}>
            <UserPlus size={14} className="mr-1" /> Vincular Paciente
          </Button>
        </div>
      )}

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Vincular Paciente</DialogTitle>
            <DialogDescription>Busque um paciente existente ou crie um novo com os dados do lead.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por nome ou telefone..."
                onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
              />
              <Button size="sm" onClick={handleSearch} disabled={searching}>
                <Search size={14} />
              </Button>
            </div>

            {searchResults.length > 0 && (
              <div className="max-h-48 overflow-y-auto space-y-1">
                {searchResults.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => linkPaciente(p.id)}
                    className="w-full text-left p-2 rounded hover:bg-secondary transition-colors text-sm"
                  >
                    <span className="font-medium text-foreground">{p.nome}</span>
                    <span className="text-muted-foreground ml-2">{p.telefone}</span>
                  </button>
                ))}
              </div>
            )}

            {searchResults.length === 0 && searchTerm && !searching && (
              <p className="text-sm text-muted-foreground text-center">Nenhum paciente encontrado.</p>
            )}

            {/* City selection before creating */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Cidade do Lead</label>
              <select
                value={cidade}
                onChange={(e) => setCidade(e.target.value)}
                className="flex h-8 w-full rounded-md border border-input bg-secondary px-3 py-1 text-xs text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value={EMPTY_CITY_VALUE}>Sem localização</option>
                {CIDADES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>Cancelar</Button>
            <Button onClick={() => createAndLinkPaciente(false)}>
              <UserPlus size={14} className="mr-1" /> Criar Paciente com Dados do Lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate phone confirmation dialog */}
      <Dialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Telefone já cadastrado</DialogTitle>
            <DialogDescription>
              Encontramos {duplicates.length} paciente{duplicates.length > 1 ? "s" : ""} com este telefone. Vincule a um existente ou cadastre como pessoa diferente (mesmo telefone).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {duplicates.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 p-2 rounded border border-border bg-secondary/50">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{p.nome}</p>
                  <p className="text-xs text-muted-foreground truncate">{p.telefone}{p.cidade ? ` · ${p.cidade}` : ""}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => linkExistingFromDuplicate(p.id)}>
                  Vincular
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setDuplicateOpen(false)}>Cancelar</Button>
            <Button onClick={() => createAndLinkPaciente(true)}>
              <UserPlus size={14} className="mr-1" /> Cadastrar como pessoa diferente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
