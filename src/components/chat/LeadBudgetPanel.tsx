import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { DollarSign, Plus, ExternalLink, Search, UserPlus, MapPin, Star, X } from "lucide-react";

const CIDADES = ["Vitória da Conquista", "Guanambi", "Ipiaú", "Itabuna"];
const EMPTY_CITY_VALUE = "none";
const ORIGENS = ["Anúncio", "Instagram", "Google Ads", "Facebook", "Indicação", "Site", "Outros"];
const EMPTY_ORIGEM_VALUE = "none";

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

type LinkedPaciente = Paciente & { link_id: string; is_primary: boolean };

type OrcamentoComPago = {
  id: string;
  paciente_id: string;
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
  const [linkedPacientes, setLinkedPacientes] = useState<LinkedPaciente[]>([]);
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
  const [newPersonName, setNewPersonName] = useState("");
  const [newOrigem, setNewOrigem] = useState<string>(EMPTY_ORIGEM_VALUE);
  const [newNomeAnuncio, setNewNomeAnuncio] = useState("");
  const [newOrigemOutros, setNewOrigemOutros] = useState("");

  useEffect(() => {
    setCidade(lead.cidade || EMPTY_CITY_VALUE);
  }, [lead.id, lead.cidade]);

  useEffect(() => {
    void fetchAllLinks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  const fetchAllLinks = async () => {
    const { data: links } = await supabase
      .from("crm_lead_pacientes")
      .select("id, is_primary, paciente_id, pacientes(id, nome, telefone, email, cidade)")
      .eq("lead_id", lead.id)
      .order("is_primary", { ascending: false });

    const list: LinkedPaciente[] = (links || [])
      .filter((l: any) => l.pacientes)
      .map((l: any) => ({
        link_id: l.id,
        is_primary: l.is_primary,
        ...l.pacientes,
      }));

    setLinkedPacientes(list);

    if (list.length === 0) {
      setOrcamentos([]);
      setTotalPaid(0);
      setTotalBudgeted(0);
      // Auto-link by phone signature if no link exists yet
      if (!autoLinkAttemptedRef.current.has(lead.id)) {
        autoLinkAttemptedRef.current.add(lead.id);
        void autoLinkByPhone();
      }
    } else {
      void fetchBudgetsForPacientes(list.map((p) => p.id));
    }
  };

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
      await addPacienteLink(data[0].id, true);
    } else {
      setSearchResults(data);
    }
  };

  const fetchBudgetsForPacientes = async (pacienteIds: string[]) => {
    const [oRes, pagRes] = await Promise.all([
      supabase.from("orcamentos").select("id, paciente_id, valor_orcado, status, created_at").in("paciente_id", pacienteIds),
      supabase.from("pagamentos").select("valor, orcamento_id, paciente_id").in("paciente_id", pacienteIds),
    ]);

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
    } else {
      setOrcamentos([]);
      setTotalBudgeted(0);
    }

    if (paid !== (lead.value || 0)) {
      await supabase.from("crm_leads").update({ value: paid }).eq("id", lead.id);
      onLeadUpdated({ value: paid });
    }
  };

  const addPacienteLink = async (pacienteId: string, makePrimary: boolean) => {
    const isFirst = linkedPacientes.length === 0;
    const { error } = await supabase
      .from("crm_lead_pacientes")
      .insert({ lead_id: lead.id, paciente_id: pacienteId, is_primary: makePrimary || isFirst });
    if (error) {
      if (error.code === "23505") {
        toast.info("Esse paciente já está vinculado a este lead.");
      } else {
        toast.error(`Erro ao vincular: ${error.message}`);
      }
      return;
    }
    if (makePrimary || isFirst) onLeadUpdated({ paciente_id: pacienteId });
    await fetchAllLinks();
    setLinkOpen(false);
    setDuplicateOpen(false);
    toast.success("Paciente vinculado ao lead");
  };

  const setAsPrimary = async (linkId: string, pacienteId: string) => {
    const { error } = await supabase
      .from("crm_lead_pacientes")
      .update({ is_primary: true })
      .eq("id", linkId);
    if (error) { toast.error("Erro ao definir principal"); return; }
    onLeadUpdated({ paciente_id: pacienteId });
    await fetchAllLinks();
  };

  const removeLink = async (linkId: string) => {
    if (!confirm("Remover este paciente deste lead?")) return;
    const { error } = await supabase.from("crm_lead_pacientes").delete().eq("id", linkId);
    if (error) { toast.error(`Erro ao remover: ${error.message}`); return; }
    await fetchAllLinks();
    toast.success("Vínculo removido");
  };

  const handleCidadeChange = async (val: string) => {
    const normalizedCity = val === EMPTY_CITY_VALUE ? null : val;
    const previousCity = cidade;
    setCidade(val);
    onLeadUpdated({ cidade: normalizedCity });
    setSavingCity(true);

    const primaryId = linkedPacientes.find((p) => p.is_primary)?.id || lead.paciente_id;
    const [leadRes, pacienteRes] = await Promise.all([
      supabase.from("crm_leads").update({ cidade: normalizedCity, updated_at: new Date().toISOString() }).eq("id", lead.id),
      primaryId ? supabase.from("pacientes").update({ cidade: normalizedCity }).eq("id", primaryId) : Promise.resolve({ error: null }),
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
      const tail = cleanSearch.slice(-8);
      const pattern = "%" + tail.split("").join("%") + "%";
      query = query.or(`telefone.ilike.${pattern},nome.ilike.%${searchTerm}%`);
    } else {
      query = query.or(`nome.ilike.%${searchTerm}%,telefone.ilike.%${searchTerm}%`);
    }
    const { data } = await query;
    setSearchResults(data || []);
    setSearching(false);
  };

  const stripCountryCode = (phone: string) => {
    let clean = phone.replace(/\D/g, "");
    if (clean.startsWith("55") && clean.length >= 12) clean = clean.slice(2);
    return clean;
  };

  const createAndLinkPaciente = async (force = false, customName?: string) => {
    const normalizedCity = cidade === EMPTY_CITY_VALUE ? null : cidade;
    const phoneClean = stripCountryCode(lead.phone || "").replace(/\D/g, "");
    const nomeFinal = (customName || newPersonName || lead.name).trim();
    if (!nomeFinal) { toast.error("Informe o nome da pessoa"); return; }

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

    const origemFinal = newOrigem === EMPTY_ORIGEM_VALUE ? null : newOrigem;
    const nomeAnuncioFinal =
      origemFinal === "Anúncio" ? (newNomeAnuncio.trim() || null)
      : origemFinal === "Outros" ? (newOrigemOutros.trim() || null)
      : null;

    const { data, error } = await supabase.from("pacientes").insert({
      nome: nomeFinal,
      telefone: stripCountryCode(lead.phone || ""),
      cidade: normalizedCity,
      origem: origemFinal,
    }).select("id").single();
    if (error || !data) { toast.error("Erro ao criar paciente"); return; }

    const isFirst = linkedPacientes.length === 0;
    await supabase.from("crm_lead_pacientes").insert({
      lead_id: lead.id, paciente_id: data.id, is_primary: isFirst,
    });

    // Update lead with origem info if provided
    const leadUpdates: Record<string, any> = {};
    if (origemFinal) leadUpdates.source = origemFinal;
    if (nomeAnuncioFinal) leadUpdates.nome_anuncio = nomeAnuncioFinal;
    if (origemFinal || nomeAnuncioFinal) {
      await supabase.from("crm_leads").update({
        ...(origemFinal ? { source: origemFinal } : {}),
        ...(nomeAnuncioFinal ? { nome_anuncio: nomeAnuncioFinal } : {}),
      }).eq("id", lead.id);
    }

    if (isFirst) onLeadUpdated({ paciente_id: data.id, cidade: normalizedCity });
    await fetchAllLinks();

    setLinkOpen(false);
    setDuplicateOpen(false);
    setNewPersonName("");
    setNewOrigem(EMPTY_ORIGEM_VALUE);
    setNewNomeAnuncio("");
    setNewOrigemOutros("");
    toast.success("Paciente criado e vinculado!");

    navigate("/atendimento", {
      state: {
        pacienteId: data.id,
        pacienteNome: nomeFinal,
        pacienteTelefone: stripCountryCode(lead.phone || ""),
      },
    });
  };

  const goToAtendimentoForPaciente = (p: LinkedPaciente) => {
    navigate("/atendimento", {
      state: { pacienteId: p.id, pacienteNome: p.nome, pacienteTelefone: p.telefone },
    });
  };

  const formatCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="p-4 border-b border-border">
      <div className="flex items-center gap-2 mb-2">
        <DollarSign size={14} className="text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase">Orçamento & Valor</span>
      </div>

      {/* City selector */}
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
          {CIDADES.map((c) => (<option key={c} value={c}>{c}</option>))}
        </select>
      </div>

      {linkedPacientes.length > 0 ? (
        <div className="space-y-2">
          {/* List all linked patients */}
          <div className="space-y-1">
            {linkedPacientes.map((p) => (
              <div key={p.link_id} className="p-2 bg-secondary/50 rounded text-sm group">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      {p.is_primary && <Star size={12} className="text-primary fill-primary flex-shrink-0" />}
                      <button
                        onClick={() => goToAtendimentoForPaciente(p)}
                        className="font-medium text-foreground truncate hover:text-primary text-left"
                        title="Abrir no atendimento"
                      >
                        {p.nome}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{p.telefone}</p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!p.is_primary && (
                      <button
                        onClick={() => setAsPrimary(p.link_id, p.id)}
                        className="text-xs text-muted-foreground hover:text-primary"
                        title="Definir como principal"
                      >
                        <Star size={12} />
                      </button>
                    )}
                    <button
                      onClick={() => removeLink(p.link_id)}
                      className="text-muted-foreground hover:text-destructive"
                      title="Remover vínculo"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Add another person with same phone */}
          <Button
            size="sm" variant="ghost"
            className="w-full text-xs h-7 text-muted-foreground hover:text-primary"
            onClick={() => { setLinkOpen(true); setSearchTerm(stripCountryCode(lead.phone || "")); setSearchResults([]); setNewPersonName(""); }}
          >
            <UserPlus size={12} className="mr-1" /> Adicionar outra pessoa com este telefone
          </Button>

          {/* Payment totals (combined across all linked patients) */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div>
              <span className="text-xs text-muted-foreground">Valor Contratado (pago)</span>
              <p className="text-primary font-bold text-lg">{formatCurrency(totalPaid)}</p>
            </div>
            <div className="text-right">
              <span className="text-xs text-muted-foreground">Orçado</span>
              <p className="text-sm text-muted-foreground">{formatCurrency(totalBudgeted)}</p>
            </div>
          </div>

          {orcamentos.length > 0 && (
            <div className="space-y-1">
              {orcamentos.map(o => (
                <div key={o.id} className="flex items-center justify-between text-xs p-1.5 bg-muted/30 rounded">
                  <span className="text-muted-foreground">Orç. {formatCurrency(o.valor_orcado)}</span>
                  <span className={o.valor_pago > 0 ? "text-primary font-medium" : "text-muted-foreground"}>
                    Pago: {formatCurrency(o.valor_pago)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <Button size="sm" variant="outline" className="w-full" onClick={() => goToAtendimentoForPaciente(linkedPacientes[0])}>
            <Plus size={14} className="mr-1" /> Novo Orçamento / Atendimento
            <ExternalLink size={12} className="ml-auto" />
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Nenhum paciente vinculado</p>
          <Button size="sm" variant="outline" className="w-full" onClick={() => { setLinkOpen(true); setSearchTerm(stripCountryCode(lead.phone || "") || lead.name); setSearchResults([]); setNewPersonName(""); }}>
            <UserPlus size={14} className="mr-1" /> Vincular Paciente
          </Button>
        </div>
      )}

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Vincular Paciente</DialogTitle>
            <DialogDescription>Busque um existente, ou crie uma nova pessoa (ex: familiar com o mesmo número).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por nome ou telefone..."
                onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
              />
              <Button size="sm" onClick={handleSearch} disabled={searching}><Search size={14} /></Button>
            </div>

            {searchResults.length > 0 && (
              <div className="max-h-48 overflow-y-auto space-y-1">
                {searchResults.map((p) => {
                  const already = linkedPacientes.some((lp) => lp.id === p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => !already && addPacienteLink(p.id, false)}
                      disabled={already}
                      className="w-full text-left p-2 rounded hover:bg-secondary transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="font-medium text-foreground">{p.nome}</span>
                      <span className="text-muted-foreground ml-2">{p.telefone}</span>
                      {already && <span className="text-xs text-primary ml-2">(já vinculado)</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {searchResults.length === 0 && searchTerm && !searching && (
              <p className="text-sm text-muted-foreground text-center">Nenhum paciente encontrado.</p>
            )}

            <div className="border-t border-border pt-3 space-y-2">
              <label className="text-xs font-medium text-foreground">Ou criar nova pessoa</label>
              <Input
                value={newPersonName}
                onChange={(e) => setNewPersonName(e.target.value)}
                placeholder={`Nome (padrão: ${lead.name})`}
              />
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Cidade</label>
                <select
                  value={cidade}
                  onChange={(e) => setCidade(e.target.value)}
                  className="flex h-8 w-full rounded-md border border-input bg-secondary px-3 py-1 text-xs text-foreground"
                >
                  <option value={EMPTY_CITY_VALUE}>Sem localização</option>
                  {CIDADES.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>Cancelar</Button>
            <Button onClick={() => createAndLinkPaciente(false)}>
              <UserPlus size={14} className="mr-1" /> Criar e Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate phone confirmation */}
      <Dialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Telefone já cadastrado</DialogTitle>
            <DialogDescription>
              Encontramos {duplicates.length} paciente{duplicates.length > 1 ? "s" : ""} com este telefone. Vincule a um existente ou cadastre como pessoa diferente (mesmo telefone).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {duplicates.map((p) => {
              const already = linkedPacientes.some((lp) => lp.id === p.id);
              return (
                <div key={p.id} className="flex items-center justify-between gap-2 p-2 rounded border border-border bg-secondary/50">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{p.nome}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.telefone}{p.cidade ? ` · ${p.cidade}` : ""}</p>
                  </div>
                  <Button size="sm" variant="outline" disabled={already} onClick={() => addPacienteLink(p.id, false)}>
                    {already ? "Já vinculado" : "Vincular"}
                  </Button>
                </div>
              );
            })}
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
