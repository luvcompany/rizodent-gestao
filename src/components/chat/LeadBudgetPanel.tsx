import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { DollarSign, Plus, ExternalLink, Search, UserPlus, Star, X, ChevronDown } from "lucide-react";
import { comValorAtual, useCidadesDoTenant } from "@/hooks/useOpcoesDoTenant";
import { mensagemDeErro } from "@/lib/mensagemDeErro";
import { formatPhoneDisplayBR, normalizePhoneParaGravar } from "@/lib/phoneUtils";

const EMPTY_CITY_VALUE = "none";

type Lead = {
  id: string;
  name: string;
  phone: string | null;
  paciente_id: string | null;
  value: number | null;
  cidade?: string | null;
  stage_id?: string | null;
  pipeline_id?: string | null;
};

type Paciente = {
  id: string;
  nome: string;
  telefone: string;
  email: string | null;
  cidade: string | null;
};

type LinkedPaciente = Paciente & { link_id: string; is_primary: boolean };

type Props = {
  lead: Lead;
  onLeadUpdated: (updates: Partial<Lead>) => void;
};

/**
 * "Orçamento & Valor" do painel do lead: pacientes vinculados, valor pago e
 * atalho para o atendimento.
 *
 * Só é montado para crc, gerente e superadmin (X-2): recepção, closer e SDR não
 * acessam pacientes (RESTRICTIVE *_sem_acesso_pacientes) e a pós-venda lê mas
 * não cria — o painel oferecia "Vincular"/"Criar" que o banco sempre recusava.
 *
 * A Cidade do lead NÃO fica mais aqui (CONV-19): havia dois seletores no mesmo
 * painel gravando crm_leads.cidade. O campo único é o LeadExtraFields (que
 * também acompanha a cidade do paciente principal); aqui a cidade só entra no
 * cadastro da pessoa nova, quando o lead ainda não tem.
 */
export default function LeadBudgetPanel({ lead, onLeadUpdated }: Props) {
  const navigate = useNavigate();
  const autoLinkAttemptedRef = useRef<Set<string>>(new Set());
  const [linkedPacientes, setLinkedPacientes] = useState<LinkedPaciente[]>([]);
  const [totalPaid, setTotalPaid] = useState(0);
  const [cidade, setCidade] = useState(lead.cidade || EMPTY_CITY_VALUE);
  // Opções = cidades das clínicas ativas do tenant (+ a do lead, se for outra).
  const cidades = comValorAtual(useCidadesDoTenant(), lead.cidade);
  const [linkOpen, setLinkOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<Paciente[]>([]);
  const [searching, setSearching] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicates, setDuplicates] = useState<Paciente[]>([]);
  const [newPersonName, setNewPersonName] = useState("");
  

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
      setTotalPaid(0);
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
    // Busca ampla e filtra client-side por dígitos (sufixo exato).
    // Evita o falso positivo do padrão frouxo `%d1%d2%...%` que casava
    // dígitos em ordem com qualquer coisa entre eles.
    const { data: candidates } = await supabase
      .from("pacientes")
      .select("id, nome, telefone, email, cidade")
      .ilike("telefone", `%${tail.slice(-4)}%`)
      .limit(50);
    const data = (candidates || []).filter((p: any) => {
      const d = String(p.telefone || "").replace(/\D/g, "");
      return d.length >= 8 && d.endsWith(tail);
    });
    if (data.length === 0) return;
    if (data.length === 1) {
      await addPacienteLink(data[0].id, true);
    } else {
      setSearchResults(data);
    }
  };

  const fetchBudgetsForPacientes = async (pacienteIds: string[]) => {
    const { data: payments } = await supabase
      .from("pagamentos")
      .select("valor, paciente_id")
      .in("paciente_id", pacienteIds);

    const paid = (payments || []).reduce((sum, p: any) => sum + Number(p.valor || 0), 0);
    setTotalPaid(paid);

    if (paid !== (lead.value || 0)) {
      // Sincronização automática, sem toast: o card só mostra o valor novo se o
      // banco realmente gravou (RLS que recusa devolve sucesso com zero linhas).
      const { data: updated, error } = await supabase
        .from("crm_leads")
        .update({ value: paid })
        .eq("id", lead.id)
        .select("id");
      if (!error && updated && updated.length > 0) onLeadUpdated({ value: paid });
    }

    // Pagamento não move mais o lead daqui. Desde 17/09/2026 quem muda a etapa
    // é o banco, e só depois da espera de 24 h (fila crm_contratado_pendente +
    // cron 'contratado-apos-carencia'): abrir o painel do lead não pode tirá-lo
    // da tela da SDR antes de ela marcar a presença.
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
        toast.error(`Erro ao vincular: ${mensagemDeErro(error)}`);
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
    const { data, error } = await supabase
      .from("crm_lead_pacientes")
      .update({ is_primary: true })
      .eq("id", linkId)
      .select("id");
    if (error) { toast.error("Erro ao definir principal: " + mensagemDeErro(error)); return; }
    if (!data || data.length === 0) {
      toast.error("Seu perfil não tem permissão para definir o paciente principal.");
      return;
    }
    onLeadUpdated({ paciente_id: pacienteId });
    await fetchAllLinks();
  };

  const removeLink = async (linkId: string) => {
    if (!confirm("Remover este paciente deste lead?")) return;
    const { data, error } = await supabase
      .from("crm_lead_pacientes")
      .delete()
      .eq("id", linkId)
      .select("id");
    if (error) { toast.error(`Erro ao remover: ${mensagemDeErro(error)}`); return; }
    if (!data || data.length === 0) {
      toast.error("Seu perfil não tem permissão para desvincular este paciente.");
      return;
    }
    await fetchAllLinks();
    toast.success("Vínculo removido");
  };

  const handleSearch = async () => {
    if (!searchTerm.trim()) return;
    setSearching(true);
    const cleanSearch = searchTerm.replace(/\D/g, "");
    const isPhoneSearch = cleanSearch.length >= 4;
    if (isPhoneSearch) {
      const tail = cleanSearch.slice(-8);
      // Busca ampla e filtra por sufixo exato em dígitos client-side.
      const { data } = await supabase
        .from("pacientes")
        .select("id, nome, telefone, email, cidade")
        .or(`telefone.ilike.%${tail.slice(-4)}%,nome.ilike.%${searchTerm}%`)
        .limit(50);
      const filtered = (data || []).filter((p: any) => {
        const d = String(p.telefone || "").replace(/\D/g, "");
        const nameMatch = p.nome?.toLowerCase().includes(searchTerm.toLowerCase());
        const phoneMatch = d.length >= 8 && d.endsWith(tail);
        return nameMatch || phoneMatch;
      });
      setSearchResults(filtered);
    } else {
      const { data } = await supabase
        .from("pacientes")
        .select("id, nome, telefone, email, cidade")
        .or(`nome.ilike.%${searchTerm}%,telefone.ilike.%${searchTerm}%`)
        .limit(20);
      setSearchResults(data || []);
    }
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
    // CRC-26: o paciente nasce no MESMO formato do lead (55 + DDD + número,
    // com o 9 do celular) — antes ia sem o 55 e ficava diferente dos demais.
    const telefonePaciente = normalizePhoneParaGravar(lead.phone) || null;
    const nomeFinal = (customName || newPersonName || lead.name).trim();
    if (!nomeFinal) { toast.error("Informe o nome da pessoa"); return; }

    if (!force && phoneClean.length >= 8) {
      const tail = phoneClean.slice(-8);
      const { data: candidates } = await supabase
        .from("pacientes")
        .select("id, nome, telefone, email, cidade")
        .ilike("telefone", `%${tail.slice(-4)}%`)
        .limit(50);
      const existing = (candidates || []).filter((p: any) => {
        const d = String(p.telefone || "").replace(/\D/g, "");
        return d.length >= 8 && d.endsWith(tail);
      });
      if (existing.length > 0) {
        setDuplicates(existing);
        setDuplicateOpen(true);
        return;
      }
    }

    // Origem/anúncio: propagação automática via gatilho no banco
    // (propagate_lead_to_paciente). Não gravamos aqui.
    const { data, error } = await supabase.from("pacientes").insert({
      nome: nomeFinal,
      telefone: telefonePaciente,
      cidade: normalizedCity,
    }).select("id").single();
    if (error || !data) {
      toast.error("Erro ao criar paciente" + (error ? ": " + mensagemDeErro(error) : ""));
      return;
    }

    // CRC-04: o gatilho auto_link_paciente_to_lead pode já ter vinculado o
    // paciente a ESTE lead pelo telefone. Um insert simples dava 23505 e a tela
    // dizia "erro ao vincular" com o vínculo feito. Upsert que ignora o
    // duplicado e, depois, o que vale é o que está no banco.
    const isFirst = linkedPacientes.length === 0;
    const { error: linkError } = await supabase
      .from("crm_lead_pacientes")
      .upsert(
        { lead_id: lead.id, paciente_id: data.id, is_primary: isFirst },
        { onConflict: "lead_id,paciente_id", ignoreDuplicates: true },
      );
    const { data: vinculo } = await supabase
      .from("crm_lead_pacientes")
      .select("id, is_primary")
      .eq("lead_id", lead.id)
      .eq("paciente_id", data.id)
      .maybeSingle();
    const vinculado = !!vinculo;

    if (!vinculado) {
      // O paciente foi criado; só o vínculo falhou — não anunciar "vinculado".
      toast.error(
        "Paciente criado, mas não foi possível vinculá-lo a este lead" +
          (linkError ? ": " + mensagemDeErro(linkError) : "."),
      );
    } else if (vinculo.is_primary || isFirst) {
      onLeadUpdated({ paciente_id: data.id });
    }
    await fetchAllLinks();

    setLinkOpen(false);
    setDuplicateOpen(false);
    setNewPersonName("");
    if (vinculado) toast.success("Paciente criado e vinculado!");

    navigate("/atendimento", {
      state: {
        pacienteId: data.id,
        pacienteNome: nomeFinal,
        pacienteTelefone: telefonePaciente,
        pacienteCidade: normalizedCity,
      },
    });
  };

  const goToAtendimentoForPaciente = (p: LinkedPaciente) => {
    navigate("/atendimento", {
      state: {
        pacienteId: p.id,
        pacienteNome: p.nome,
        pacienteTelefone: p.telefone,
        pacienteCidade: p.cidade || (cidade === EMPTY_CITY_VALUE ? null : cidade),
      },
    });
  };

  const formatCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="border-b border-border/60 px-5 py-5">
      <div className="mb-4 flex items-center gap-2">
        <DollarSign size={16} strokeWidth={1.75} className="shrink-0 text-tertiary" />
        <span className="text-[15px] font-semibold text-foreground">Orçamento & Valor</span>
      </div>

      {linkedPacientes.length > 0 ? (
        <div className="space-y-3">
          {/* List all linked patients */}
          <div className="space-y-2">
            {linkedPacientes.map((p) => (
              <div key={p.link_id} className="group rounded-xl border border-border/60 bg-card p-3 text-sm transition-shadow hover:shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {p.is_primary && <Star size={14} strokeWidth={1.75} className="shrink-0 fill-warning text-warning" />}
                      <button
                        onClick={() => goToAtendimentoForPaciente(p)}
                        className="min-w-0 truncate text-left font-semibold text-foreground transition-colors hover:text-primary"
                        title="Abrir no atendimento"
                      >
                        {p.nome}
                      </button>
                    </div>
                    <p className="mt-0.5 truncate text-xs tabular-nums text-tertiary">{formatPhoneDisplayBR(p.telefone)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    {!p.is_primary && (
                      <button
                        onClick={() => setAsPrimary(p.link_id, p.id)}
                        className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-warning-soft hover:text-warning"
                        title="Definir como principal"
                      >
                        <Star size={14} strokeWidth={1.75} />
                      </button>
                    )}
                    <button
                      onClick={() => removeLink(p.link_id)}
                      className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive-soft hover:text-destructive"
                      title="Remover vínculo"
                    >
                      <X size={14} strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Add another person with same phone */}
          <Button
            size="sm" variant="ghost"
            className="h-auto min-h-9 w-full justify-start gap-2 whitespace-normal rounded-xl px-3 py-2 text-left text-[13px] font-medium text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
            onClick={() => { setLinkOpen(true); setSearchTerm(stripCountryCode(lead.phone || "")); setSearchResults([]); setNewPersonName(""); }}
          >
            <UserPlus size={15} strokeWidth={1.75} className="shrink-0" /> Adicionar outra pessoa com este telefone
          </Button>

          {/* Payment totals (combined across all linked patients) */}
          <div className="flex items-center justify-between rounded-xl bg-primary-soft-2 px-4 py-3.5">
            <div className="min-w-0">
              <span className="text-[13px] font-medium text-muted-foreground">Valor Contratado (pago)</span>
              <p className="mt-0.5 text-2xl font-bold leading-tight tracking-tight tabular-nums text-primary [overflow-wrap:anywhere]">{formatCurrency(totalPaid)}</p>
            </div>
          </div>

          <Button size="sm" variant="outline" className="h-10 w-full gap-1.5 rounded-xl text-[13px] font-medium" onClick={() => goToAtendimentoForPaciente(linkedPacientes[0])}>
            <Plus size={15} strokeWidth={1.75} /> Novo Atendimento
            <ExternalLink size={14} strokeWidth={1.75} className="ml-auto text-tertiary" />
          </Button>
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border border-dashed border-border bg-surface-sunken/60 p-4 text-center">
          <p className="text-[13px] text-muted-foreground">Nenhum paciente vinculado</p>
          <Button size="sm" variant="outline" className="h-10 w-full gap-1.5 rounded-xl text-[13px] font-medium" onClick={() => { setLinkOpen(true); setSearchTerm(stripCountryCode(lead.phone || "") || lead.name); setSearchResults([]); setNewPersonName(""); }}>
            <UserPlus size={15} strokeWidth={1.75} /> Vincular Paciente
          </Button>
        </div>
      )}

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold tracking-tight">Vincular Paciente</DialogTitle>
            <DialogDescription>Busque um existente, ou crie uma nova pessoa (ex: familiar com o mesmo número).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por nome ou telefone..."
                className="h-10 rounded-xl"
                onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
              />
              <Button size="sm" className="h-10 w-10 shrink-0 rounded-xl p-0" onClick={handleSearch} disabled={searching}><Search size={16} strokeWidth={1.75} /></Button>
            </div>

            {searchResults.length > 0 && (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border/60 p-1">
                {searchResults.map((p) => {
                  const already = linkedPacientes.some((lp) => lp.id === p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => !already && addPacienteLink(p.id, false)}
                      disabled={already}
                      className="w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="font-medium text-foreground">{p.nome}</span>
                      <span className="ml-2 tabular-nums text-muted-foreground">{formatPhoneDisplayBR(p.telefone)}</span>
                      {already && <span className="ml-2 text-xs font-medium text-primary">(já vinculado)</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {searchResults.length === 0 && searchTerm && !searching && (
              <p className="rounded-xl bg-surface-sunken px-3 py-3 text-center text-[13px] text-muted-foreground">Nenhum paciente encontrado.</p>
            )}

            <div className="space-y-2.5 border-t border-border/60 pt-4">
              <label className="block text-[13px] font-semibold text-foreground">Ou criar nova pessoa</label>
              <Input
                value={newPersonName}
                onChange={(e) => setNewPersonName(e.target.value)}
                placeholder={`Nome (padrão: ${lead.name})`}
                className="h-10 rounded-xl"
              />
              {cidade === EMPTY_CITY_VALUE && (
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Cidade</label>
                  <span className="relative block">
                  <select
                    value={cidade}
                    onChange={(e) => setCidade(e.target.value)}
                    className="flex h-10 w-full cursor-pointer appearance-none rounded-xl border border-input bg-card pl-3.5 pr-10 text-sm text-foreground ring-offset-background transition-colors hover:border-border focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value={EMPTY_CITY_VALUE}>Sem localização</option>
                    {cidades.map((c) => (<option key={c} value={c}>{c}</option>))}
                  </select>
                  <ChevronDown size={16} strokeWidth={1.75} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tertiary" />
                  </span>
                </div>
              )}
              <p className="text-xs italic leading-relaxed text-tertiary">
                Origem, cidade e anúncio são propagados automaticamente do lead para o paciente ao vincular.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-10 rounded-xl px-4" onClick={() => setLinkOpen(false)}>Cancelar</Button>
            <Button className="h-10 gap-1.5 rounded-xl px-5" onClick={() => createAndLinkPaciente(false)}>
              <UserPlus size={15} strokeWidth={1.75} /> Criar e Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate phone confirmation */}
      <Dialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold tracking-tight">Telefone já cadastrado</DialogTitle>
            <DialogDescription>
              Encontramos {duplicates.length} paciente{duplicates.length > 1 ? "s" : ""} com este telefone. Vincule a um existente ou cadastre como pessoa diferente (mesmo telefone).
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-60 space-y-2 overflow-y-auto">
            {duplicates.map((p) => {
              const already = linkedPacientes.some((lp) => lp.id === p.id);
              return (
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-surface-sunken/60 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{p.nome}</p>
                    <p className="mt-0.5 truncate text-xs tabular-nums text-tertiary">{formatPhoneDisplayBR(p.telefone)}{p.cidade ? ` · ${p.cidade}` : ""}</p>
                  </div>
                  <Button size="sm" variant="outline" className="h-9 shrink-0 rounded-xl px-3.5 text-[13px] font-medium" disabled={already} onClick={() => addPacienteLink(p.id, false)}>
                    {already ? "Já vinculado" : "Vincular"}
                  </Button>
                </div>
              );
            })}
          </div>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" className="h-10 rounded-xl px-4" onClick={() => setDuplicateOpen(false)}>Cancelar</Button>
            <Button className="h-10 gap-1.5 rounded-xl px-5" onClick={() => createAndLinkPaciente(true)}>
              <UserPlus size={15} strokeWidth={1.75} /> Cadastrar como pessoa diferente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
