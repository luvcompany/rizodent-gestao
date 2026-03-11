import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Search, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables } from "@/integrations/supabase/types";

const formasPagamento = ["Dinheiro", "Pix", "Cartão de Crédito", "Cartão de Débito", "Boleto", "Financiamento"];
const origens = ["Instagram", "Google Ads", "Facebook", "Indicação", "Site", "Outros"];

const Atendimento = () => {
  const { user } = useAuth();
  const [clinicas, setClinicas] = useState<Tables<"clinicas">[]>([]);
  const [tiposProcedimento, setTiposProcedimento] = useState<{ id: string; nome: string; valor_referencia: number | null }[]>([]);
  const [telefone, setTelefone] = useState("");
  const [nome, setNome] = useState("");
  const [clinicaId, setClinicaId] = useState("");
  const [cidade, setCidade] = useState("");
  const [procedimento, setProcedimento] = useState("");
  const [valorOrcado, setValorOrcado] = useState("");
  const [valorNaoContratado, setValorNaoContratado] = useState("");
  const [valorPago, setValorPago] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("");
  const [tipoPagamento, setTipoPagamento] = useState("");
  const [origem, setOrigem] = useState("");
  const [nomeAnuncio, setNomeAnuncio] = useState("");
  const [sugestoes, setSugestoes] = useState<Tables<"pacientes">[]>([]);
  const [pacienteSelecionadoId, setPacienteSelecionadoId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("clinicas").select("*").eq("ativa", true).then(({ data }) => {
      if (data) setClinicas(data);
    });
    supabase.from("tipos_procedimento").select("id, nome, valor_referencia").eq("ativo", true).order("nome").then(({ data }) => {
      if (data) setTiposProcedimento(data as any);
    });
  }, []);

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 2) return `(${digits}`;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
  };

  const handlePhoneChange = async (value: string) => {
    const formatted = formatPhone(value);
    setTelefone(formatted);
    setPacienteSelecionadoId(null);

    const digits = value.replace(/\D/g, "");
    if (digits.length >= 4) {
      const { data } = await supabase
        .from("pacientes")
        .select("*")
        .ilike("telefone", `%${digits}%`)
        .limit(5);
      setSugestoes(data || []);
    } else {
      setSugestoes([]);
    }
  };

  const selecionarPaciente = (pac: Tables<"pacientes">) => {
    setTelefone(pac.telefone);
    setNome(pac.nome);
    setCidade(pac.cidade || "");
    setOrigem(pac.origem || "");
    setNomeAnuncio(pac.nome_anuncio || "");
    setPacienteSelecionadoId(pac.id);
    setSugestoes([]);
    toast.success(`Paciente ${pac.nome} selecionado!`);
  };

  const resetForm = () => {
    setTelefone(""); setNome(""); setClinicaId(""); setCidade("");
    setProcedimento(""); setValorOrcado(""); setValorContratado("");
    setValorPago(""); setFormaPagamento(""); setTipoPagamento("");
    setOrigem(""); setNomeAnuncio(""); setPacienteSelecionadoId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinicaId || !procedimento) {
      toast.error("Preencha clínica e procedimento.");
      return;
    }
    setSaving(true);

    try {
      let pacienteId = pacienteSelecionadoId;

      // Create patient if new
      if (!pacienteId) {
        const { data: newPac, error } = await supabase
          .from("pacientes")
          .insert({ nome, telefone, cidade: cidade || null, origem: origem || null, nome_anuncio: nomeAnuncio || null })
          .select("id")
          .single();
        if (error) throw error;
        pacienteId = newPac.id;
      }

      // Create tratamento
      const { data: trat, error: tratError } = await supabase
        .from("tratamentos")
        .insert({
          paciente_id: pacienteId,
          clinica_id: clinicaId,
          procedimento,
          valor_orcado: valorOrcado ? parseFloat(valorOrcado) : 0,
          valor_contratado: valorContratado ? parseFloat(valorContratado) : 0,
          created_by: user?.id,
        })
        .select("id")
        .single();
      if (tratError) throw tratError;

      // Create pagamento if value > 0
      if (valorPago && parseFloat(valorPago) > 0) {
        const { error: pagError } = await supabase
          .from("pagamentos")
          .insert({
            tratamento_id: trat.id,
            paciente_id: pacienteId,
            clinica_id: clinicaId,
            valor: parseFloat(valorPago),
            forma_pagamento: formaPagamento || "Pix",
            tipo: tipoPagamento || "primeiro",
            created_by: user?.id,
          });
        if (pagError) throw pagError;
      }

      toast.success("Atendimento registrado com sucesso!");
      resetForm();
    } catch (err: any) {
      toast.error("Erro ao salvar: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Novo Atendimento</h1>
        <p className="text-sm text-muted-foreground">Cadastro único de atendimento</p>
      </div>

      <Card className="gradient-card border-border shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCheck size={18} className="text-primary" />
            Dados do Atendimento
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Phone with smart search */}
            <div className="relative space-y-2">
              <Label>Telefone do Paciente</Label>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="(00) 00000-0000"
                  value={telefone}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  className="bg-secondary border-border pl-10"
                  maxLength={15}
                  required
                />
              </div>
              {sugestoes.length > 0 && !pacienteSelecionadoId && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-popover p-1 shadow-card">
                  {sugestoes.map((pac) => (
                    <button
                      key={pac.id}
                      type="button"
                      onClick={() => selecionarPaciente(pac)}
                      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors"
                    >
                      <UserCheck size={14} className="text-primary" />
                      <span className="font-medium">{pac.nome}</span>
                      <span className="text-muted-foreground">{pac.telefone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Nome do Paciente</Label>
              <Input placeholder="Nome completo" value={nome} onChange={(e) => setNome(e.target.value)} className="bg-secondary border-border" required />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Clínica</Label>
                <Select value={clinicaId} onValueChange={(v) => {
                  setClinicaId(v);
                  const cl = clinicas.find(c => c.id === v);
                  if (cl) setCidade(cl.cidade);
                }}>
                  <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {clinicas.map((c) => (<SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cidade</Label>
                <Input placeholder="Cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} className="bg-secondary border-border" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Procedimento</Label>
              <Select value={procedimento} onValueChange={(v) => {
                setProcedimento(v);
                const tp = tiposProcedimento.find(t => t.nome === v);
                if (tp && tp.valor_referencia && !valorOrcado) {
                  setValorOrcado(tp.valor_referencia.toString());
                }
              }}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Selecione o procedimento" /></SelectTrigger>
                <SelectContent>
                  {tiposProcedimento.map((p) => (<SelectItem key={p.id} value={p.nome}>{p.nome}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Valor Orçado (R$)</Label>
                <Input type="number" placeholder="0,00" value={valorOrcado} onChange={(e) => setValorOrcado(e.target.value)} className="bg-secondary border-border" />
              </div>
              <div className="space-y-2">
                <Label>Valor Contratado (R$)</Label>
                <Input type="number" placeholder="0,00" value={valorContratado} onChange={(e) => setValorContratado(e.target.value)} className="bg-secondary border-border" />
              </div>
              <div className="space-y-2">
                <Label>Valor Pago no Dia (R$)</Label>
                <Input type="number" placeholder="0,00" value={valorPago} onChange={(e) => setValorPago(e.target.value)} className="bg-secondary border-border" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Forma de Pagamento</Label>
                <Select value={formaPagamento} onValueChange={setFormaPagamento}>
                  <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {formasPagamento.map((f) => (<SelectItem key={f} value={f}>{f}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tipo de Pagamento</Label>
                <Select value={tipoPagamento} onValueChange={setTipoPagamento}>
                  <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="primeiro">Primeiro Pagamento</SelectItem>
                    <SelectItem value="recorrente">Recorrente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Origem do Lead</Label>
                <Select value={origem} onValueChange={setOrigem}>
                  <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {origens.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Nome do Anúncio</Label>
                <Input placeholder="Ex: Campanha Implante Jan" value={nomeAnuncio} onChange={(e) => setNomeAnuncio(e.target.value)} className="bg-secondary border-border" />
              </div>
            </div>

            <Button
              type="submit"
              disabled={saving}
              className="w-full gradient-orange text-primary-foreground font-semibold shadow-orange hover:opacity-90 transition-opacity"
            >
              <Save size={18} className="mr-2" />
              {saving ? "Salvando..." : "Salvar Atendimento"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Atendimento;
