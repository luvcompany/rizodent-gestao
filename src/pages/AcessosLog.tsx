import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { GRUPOS_EVENTO_ACESSO, rotuloEventoAcesso, type GrupoEventoAcesso } from "@/lib/accessLog";
import { cn } from "@/lib/utils";
import { RpcErrorCard } from "@/components/RpcErrorCard";
import { motivoDaFalhaDeLeitura } from "@/lib/reportKit";
import { resumoDoDispositivo } from "@/lib/dispositivo";

type AccessLog = {
  id: string;
  user_id: string | null;
  email: string | null;
  tenant_id: string | null;
  context: string | null;
  event: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

type Pessoa = { nome: string | null; email: string | null };

const VERDE = "border-transparent bg-success-soft text-success-soft-foreground";
const VERMELHO = "border-transparent bg-destructive-soft text-destructive-soft-foreground";
const AMARELO = "border-transparent bg-warning-soft text-warning-soft-foreground";
const NEUTRO = "border-transparent bg-slate-soft text-slate-soft-foreground";
const AZUL = "border-transparent bg-info-soft text-info-soft-foreground";

// CLIN-12: todos os eventos que o servidor grava têm cor (nomes em accessLog.ts).
const eventBadgeClass: Record<string, string> = {
  login: VERDE,
  logout: NEUTRO,
  login_failed: AMARELO,
  login_blocked: VERMELHO,
  user_block: VERMELHO,
  user_blocked: VERMELHO,
  user_unblock: VERDE,
  user_unblocked: VERDE,
  user_create: AZUL,
  sdr_create: AZUL,
  user_reset_password: AMARELO,
  sdr_reset_password: AMARELO,
  user_set_role: AZUL,
  user_set_email: AZUL,
  sdr_set_email: AZUL,
  user_delete: VERMELHO,
  sdr_delete: VERMELHO,
  user_delete_email_reuse: NEUTRO,
  reauth_failed: AMARELO,
  gestor_equipe_definido: AZUL,
  senha_alterada: VERDE,
  senha_redefinida: VERDE,
  senha_troca_falha: AMARELO,
  impersonate: AZUL,
  impersonate_redeem: AZUL,
  impersonate_redeem_falha: AMARELO,
};

const FILTROS: { valor: "all" | GrupoEventoAcesso; rotulo: string }[] = [
  { valor: "all", rotulo: "Todos os eventos" },
  { valor: "logins", rotulo: "Logins / Logouts" },
  { valor: "falhas", rotulo: "Tentativas falhas" },
  { valor: "bloqueios", rotulo: "Bloqueios" },
  { valor: "usuarios", rotulo: "Usuários e papéis" },
  { valor: "senhas", rotulo: "Senhas" },
  { valor: "suporte", rotulo: "Acesso de suporte" },
];

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const AcessosLog = () => {
  const { tenant } = useTenant();
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [pessoas, setPessoas] = useState<Record<string, Pessoa>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState<string>("all");
  const [erroDeCarga, setErroDeCarga] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const recarregar = () => setRecarga((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let query = supabase
        .from("access_logs" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (tenant?.id) query = query.eq("tenant_id", tenant.id);
      const { data, error } = await query;
      if (cancelled) return;
      if (error) {
        const motivo = motivoDaFalhaDeLeitura(error);
        setErroDeCarga(motivo);
        toast.error(motivo);
        setLoading(false);
        return;
      }
      setErroDeCarga(null);
      const linhas = ((data as unknown as AccessLog[]) || []);
      setLogs(linhas);
      // Nomes de quem fez e de quem sofreu a ação (ações do gestor e do suporte
      // gravam o id, não o e-mail). A RLS de profiles mostra só a equipe do
      // cliente: o suporte aparece como "Administrador".
      const ids = new Set<string>();
      for (const l of linhas) {
        if (l.user_id) ids.add(l.user_id);
        for (const k of ["target", "target_user_id", "de", "para"]) {
          const v = texto(l.metadata?.[k]);
          if (v) ids.add(v);
        }
      }
      if (ids.size > 0) {
        const { data: perfis } = await supabase
          .from("profiles")
          .select("id, nome, email")
          .in("id", Array.from(ids));
        if (!cancelled) {
          const mapa: Record<string, Pessoa> = {};
          for (const p of (perfis as { id: string; nome: string | null; email: string | null }[] | null) ?? []) {
            mapa[p.id] = { nome: p.nome, email: p.email };
          }
          setPessoas(mapa);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenant?.id, recarga]);

  const nomeDe = (id: unknown): string | null => {
    const v = texto(id);
    if (!v) return null;
    const p = pessoas[v];
    return p ? p.nome || p.email : null;
  };

  // Ação sobre OUTRA conta (gestor ou suporte criou, bloqueou, trocou e-mail…):
  // o id dela vem em metadata.target (admin-manage-user) ou target_user_id
  // (admin-impersonate).
  const alvoDe = (l: AccessLog): string | null =>
    texto(l.metadata?.target) || texto(l.metadata?.target_user_id);

  // Coluna Usuário = quem FEZ a ação: e-mail gravado na linha → nome do perfil
  // → "Administrador" (suporte, cujo perfil a RLS não mostra) → "—". O e-mail do
  // metadata só vale sem user_id (tentativa de login de quem não entrou): nas
  // ações sobre outra conta ele é o e-mail do ALVO, que vai no detalhe.
  const usuarioDe = (l: AccessLog): string =>
    l.email ||
    (!l.user_id ? texto(l.metadata?.email) : null) ||
    nomeDe(l.user_id) ||
    (l.context === "admin" ? "Administrador" : "—");

  const detalheDe = (l: AccessLog): string | null => {
    if (l.event === "gestor_equipe_definido") {
      const de = nomeDe(l.metadata?.de);
      const para = nomeDe(l.metadata?.para);
      if (para) return de ? `De ${de} para ${para}` : `Para ${para}`;
      return null;
    }
    const idAlvo = alvoDe(l);
    if (!idAlvo) return null;
    // Conta apagada (sem perfil): o e-mail gravado no registro.
    const alvo = nomeDe(idAlvo) || texto(l.metadata?.target_email) || texto(l.metadata?.email);
    return alvo ? `Conta: ${alvo}` : null;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (q) {
        const alvo = [usuarioDe(l), detalheDe(l) ?? ""].join(" ").toLowerCase();
        if (!alvo.includes(q)) return false;
      }
      if (eventFilter === "all") return true;
      const grupo = GRUPOS_EVENTO_ACESSO[eventFilter as GrupoEventoAcesso] as readonly string[] | undefined;
      return grupo ? grupo.includes(l.event) : true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, pessoas, search, eventFilter]);

  return (
    <div className="animate-fade-in space-y-5 lg:space-y-6">
      <div className="flex items-center gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><ScrollText className="text-current" size={24} /></span>
        <div className="min-w-0">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-foreground sm:text-[32px]">Logs de acesso</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Histórico de acessos, tentativas falhas, bloqueios e mudanças de conta da sua equipe.
          </p>
        </div>
      </div>

      <Card className="flex flex-col gap-3 rounded-card border-border/60 bg-card p-3 shadow-card sm:flex-row sm:items-center sm:gap-4 sm:p-4">
        <CardHeader className="space-y-0 p-0 sm:pl-1">
          <CardTitle className="text-[13px] font-semibold tracking-normal text-muted-foreground">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-1 flex-col gap-3 p-0 sm:flex-row sm:items-center">
          <Input
            placeholder="Buscar por e-mail ou nome..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 rounded-xl border-transparent bg-surface-sunken sm:max-w-xs"
          />
          <Select value={eventFilter} onValueChange={setEventFilter}>
            <SelectTrigger className="h-10 rounded-xl border-transparent bg-surface-sunken font-medium sm:max-w-xs">
              <SelectValue placeholder="Tipo de evento" />
            </SelectTrigger>
            <SelectContent>
              {FILTROS.map((f) => (
                <SelectItem key={f.valor} value={f.valor}>
                  {f.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="min-w-0 rounded-card border-border/60 bg-card shadow-card">
        <CardHeader className="space-y-0 p-5 pb-4 sm:p-6 sm:pb-5">
          <CardTitle className="text-base font-semibold leading-snug tracking-tight">
            Registros {loading ? "" : `(${filtered.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5 pt-0 sm:px-6 sm:pb-6">
          {erroDeCarga ? (
            <RpcErrorCard title="Não foi possível carregar os acessos" message={erroDeCarga} onRetry={recarregar} />
          ) : loading ? (
            <p className="rounded-xl bg-surface-sunken/60 py-10 text-center text-sm text-muted-foreground">Carregando...</p>
          ) : filtered.length === 0 ? (
            <p className="rounded-xl bg-surface-sunken/60 py-10 text-center text-sm text-muted-foreground">
              Nenhum registro encontrado.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border/60 [&_thead]:bg-surface-sunken/70 [&_thead_tr]:border-b-0 [&_td]:py-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data/Hora</TableHead>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Evento</TableHead>
                    <TableHead>Dispositivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((l) => {
                    const detalhe = detalheDe(l);
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
                          {new Date(l.created_at).toLocaleString("pt-BR")}
                        </TableCell>
                        <TableCell className="text-sm font-medium text-foreground">{usuarioDe(l)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("h-6 whitespace-nowrap rounded-full px-2.5 text-[11px] font-medium", eventBadgeClass[l.event] || NEUTRO)}>
                            {rotuloEventoAcesso(l.event)}
                          </Badge>
                          {detalhe && <p className="mt-1.5 text-xs text-tertiary">{detalhe}</p>}
                        </TableCell>
                        <TableCell
                          className="max-w-[360px] truncate text-xs text-tertiary"
                          title={l.user_agent || ""}
                        >
                          {resumoDoDispositivo(l.user_agent)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AcessosLog;
