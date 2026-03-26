import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { DollarSign, Plus, ExternalLink, Search, UserPlus } from "lucide-react";

type Lead = {
  id: string;
  name: string;
  phone: string | null;
  paciente_id: string | null;
};

type Paciente = {
  id: string;
  nome: string;
  telefone: string;
  email: string | null;
};

type Orcamento = {
  id: string;
  valor_orcado: number;
  status: string;
  created_at: string;
};

type Props = {
  lead: Lead;
  onLeadUpdated: (updates: Partial<Lead>) => void;
};

export default function LeadBudgetPanel({ lead, onLeadUpdated }: Props) {
  const navigate = useNavigate();
  const [paciente, setPaciente] = useState<Paciente | null>(null);
  const [orcamentos, setOrcamentos] = useState<Orcamento[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<Paciente[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (lead.paciente_id) {
      fetchPacienteAndBudgets(lead.paciente_id);
    } else {
      setPaciente(null);
      setOrcamentos([]);
      setTotalValue(0);
    }
  }, [lead.paciente_id]);

  const fetchPacienteAndBudgets = async (pacienteId: string) => {
    const [pRes, oRes] = await Promise.all([
      supabase.from("pacientes").select("id, nome, telefone, email").eq("id", pacienteId).single(),
      supabase.from("orcamentos").select("id, valor_orcado, status, created_at").eq("paciente_id", pacienteId).eq("status", "aberto"),
    ]);
    if (pRes.data) setPaciente(pRes.data);
    if (oRes.data) {
      setOrcamentos(oRes.data);
      setTotalValue(oRes.data.reduce((sum, o) => sum + Number(o.valor_orcado), 0));
    }
  };

  const handleSearch = async () => {
    if (!searchTerm.trim()) return;
    setSearching(true);
    const { data } = await supabase
      .from("pacientes")
      .select("id, nome, telefone, email")
      .or(`nome.ilike.%${searchTerm}%,telefone.ilike.%${searchTerm}%`)
      .limit(10);
    setSearchResults(data || []);
    setSearching(false);
  };

  const linkPaciente = async (pacienteId: string) => {
    const { error } = await supabase.from("crm_leads").update({ paciente_id: pacienteId }).eq("id", lead.id);
    if (error) { toast.error("Erro ao vincular paciente"); return; }
    onLeadUpdated({ paciente_id: pacienteId });
    setLinkOpen(false);
    toast.success("Paciente vinculado ao lead");
  };

  const stripCountryCode = (phone: string) => {
    let clean = phone.replace(/\D/g, "");
    if (clean.startsWith("55") && clean.length >= 12) clean = clean.slice(2);
    return clean;
  };

  const createAndLinkPaciente = async () => {
    const { data, error } = await supabase.from("pacientes").insert({
      nome: lead.name,
      telefone: stripCountryCode(lead.phone || ""),
    }).select("id").single();
    if (error || !data) { toast.error("Erro ao criar paciente"); return; }
    await linkPaciente(data.id);
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

      {lead.paciente_id && paciente ? (
        <div className="space-y-2">
          <div className="p-2 bg-secondary/50 rounded text-sm">
            <p className="font-medium text-foreground">{paciente.nome}</p>
            <p className="text-xs text-muted-foreground">{paciente.telefone}</p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground">Valor (orçamentos abertos)</span>
              <p className="text-primary font-bold text-lg">{formatCurrency(totalValue)}</p>
            </div>
            <span className="text-xs text-muted-foreground">{orcamentos.length} orçamento(s)</span>
          </div>
          <Button size="sm" variant="outline" className="w-full" onClick={goToAtendimento}>
            <Plus size={14} className="mr-1" /> Novo Orçamento / Atendimento
            <ExternalLink size={12} className="ml-auto" />
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Nenhum paciente vinculado</p>
          <Button size="sm" variant="outline" className="w-full" onClick={() => { setLinkOpen(true); setSearchTerm(lead.phone || lead.name); setSearchResults([]); }}>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>Cancelar</Button>
            <Button onClick={createAndLinkPaciente}>
              <UserPlus size={14} className="mr-1" /> Criar Paciente com Dados do Lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
