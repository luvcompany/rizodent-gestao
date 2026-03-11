import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Search, UserCheck } from "lucide-react";
import { toast } from "sonner";

const clinicas = ["Clínica SP", "Clínica RJ", "Clínica BH", "Clínica Curitiba", "Clínica Porto Alegre"];
const procedimentos = ["Implante", "Ortodontia", "Clareamento", "Prótese", "Limpeza", "Endodontia", "Extração", "Restauração"];
const formasPagamento = ["Dinheiro", "Pix", "Cartão de Crédito", "Cartão de Débito", "Boleto", "Financiamento"];
const origens = ["Instagram", "Google Ads", "Facebook", "Indicação", "Site", "Outros"];

// Mock patients for phone search
const mockPacientes = [
  { id: "1", nome: "Maria Silva", telefone: "(11) 99999-1234" },
  { id: "2", nome: "João Santos", telefone: "(11) 99999-5678" },
  { id: "3", nome: "Ana Oliveira", telefone: "(21) 98888-4321" },
];

const Atendimento = () => {
  const [telefone, setTelefone] = useState("");
  const [nome, setNome] = useState("");
  const [clinica, setClinica] = useState("");
  const [cidade, setCidade] = useState("");
  const [procedimento, setProcedimento] = useState("");
  const [valorOrcado, setValorOrcado] = useState("");
  const [valorContratado, setValorContratado] = useState("");
  const [valorPago, setValorPago] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("");
  const [tipoPagamento, setTipoPagamento] = useState("");
  const [origem, setOrigem] = useState("");
  const [nomeAnuncio, setNomeAnuncio] = useState("");
  const [sugestoes, setSugestoes] = useState<typeof mockPacientes>([]);
  const [pacienteSelecionado, setPacienteSelecionado] = useState(false);

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 2) return `(${digits}`;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
  };

  const handlePhoneChange = (value: string) => {
    const formatted = formatPhone(value);
    setTelefone(formatted);

    const digits = value.replace(/\D/g, "");
    if (digits.length >= 4) {
      const found = mockPacientes.filter((p) =>
        p.telefone.replace(/\D/g, "").includes(digits)
      );
      setSugestoes(found);
    } else {
      setSugestoes([]);
    }
    setPacienteSelecionado(false);
  };

  const selecionarPaciente = (pac: typeof mockPacientes[0]) => {
    setTelefone(pac.telefone);
    setNome(pac.nome);
    setSugestoes([]);
    setPacienteSelecionado(true);
    toast.success(`Paciente ${pac.nome} selecionado!`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success("Atendimento registrado com sucesso!");
    // Reset form
    setTelefone("");
    setNome("");
    setClinica("");
    setCidade("");
    setProcedimento("");
    setValorOrcado("");
    setValorContratado("");
    setValorPago("");
    setFormaPagamento("");
    setTipoPagamento("");
    setOrigem("");
    setNomeAnuncio("");
    setPacienteSelecionado(false);
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
              {sugestoes.length > 0 && !pacienteSelecionado && (
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

            {/* Name */}
            <div className="space-y-2">
              <Label>Nome do Paciente</Label>
              <Input
                placeholder="Nome completo"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="bg-secondary border-border"
                required
              />
            </div>

            {/* Clínica and Cidade */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Clínica</Label>
                <Select value={clinica} onValueChange={setClinica} required>
                  <SelectTrigger className="bg-secondary border-border">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {clinicas.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cidade</Label>
                <Input
                  placeholder="Cidade"
                  value={cidade}
                  onChange={(e) => setCidade(e.target.value)}
                  className="bg-secondary border-border"
                />
              </div>
            </div>

            {/* Procedimento */}
            <div className="space-y-2">
              <Label>Procedimento</Label>
              <Select value={procedimento} onValueChange={setProcedimento}>
                <SelectTrigger className="bg-secondary border-border">
                  <SelectValue placeholder="Selecione o procedimento" />
                </SelectTrigger>
                <SelectContent>
                  {procedimentos.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Valores */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Valor Orçado (R$)</Label>
                <Input
                  type="number"
                  placeholder="0,00"
                  value={valorOrcado}
                  onChange={(e) => setValorOrcado(e.target.value)}
                  className="bg-secondary border-border"
                />
              </div>
              <div className="space-y-2">
                <Label>Valor Contratado (R$)</Label>
                <Input
                  type="number"
                  placeholder="0,00"
                  value={valorContratado}
                  onChange={(e) => setValorContratado(e.target.value)}
                  className="bg-secondary border-border"
                />
              </div>
              <div className="space-y-2">
                <Label>Valor Pago no Dia (R$)</Label>
                <Input
                  type="number"
                  placeholder="0,00"
                  value={valorPago}
                  onChange={(e) => setValorPago(e.target.value)}
                  className="bg-secondary border-border"
                />
              </div>
            </div>

            {/* Pagamento */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Forma de Pagamento</Label>
                <Select value={formaPagamento} onValueChange={setFormaPagamento}>
                  <SelectTrigger className="bg-secondary border-border">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {formasPagamento.map((f) => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tipo de Pagamento</Label>
                <Select value={tipoPagamento} onValueChange={setTipoPagamento}>
                  <SelectTrigger className="bg-secondary border-border">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="primeiro">Primeiro Pagamento</SelectItem>
                    <SelectItem value="recorrente">Recorrente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Marketing */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Origem do Lead</Label>
                <Select value={origem} onValueChange={setOrigem}>
                  <SelectTrigger className="bg-secondary border-border">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {origens.map((o) => (
                      <SelectItem key={o} value={o}>{o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Nome do Anúncio</Label>
                <Input
                  placeholder="Ex: Campanha Implante Jan"
                  value={nomeAnuncio}
                  onChange={(e) => setNomeAnuncio(e.target.value)}
                  className="bg-secondary border-border"
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full gradient-orange text-primary-foreground font-semibold shadow-orange hover:opacity-90 transition-opacity"
            >
              <Save size={18} className="mr-2" />
              Salvar Atendimento
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Atendimento;
