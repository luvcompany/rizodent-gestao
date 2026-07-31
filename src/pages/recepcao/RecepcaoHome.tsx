import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { MessageSquare, Send, FileText, LayoutGrid, Link2, ArrowRight, Loader2 } from "lucide-react";

/**
 * Início do perfil Recepção — uma "estação de balcão", não um painel de gestão.
 *
 * O trabalho de quem está na recepção é: quem está esperando resposta, e há
 * quanto tempo. Por isso a tela é organizada pelo TEMPO DE ESPERA e não por
 * métricas de venda (que este perfil nem enxerga).
 *
 * Isolamento: rota e componentes exclusivos do papel `recepcao`. Nenhum arquivo
 * compartilhado com os outros perfis é alterado, e todas as consultas são
 * filtradas pelo banco (a recepção só alcança leads do número da sua unidade).
 */

type Fila = {
  id: string;
  name: string | null;
  phone: string | null;
  last_message: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
};

const MIN = 60_000;

function esperaMs(l: Fila): number {
  if (!l.last_inbound_at) return 0;
  const entrada = new Date(l.last_inbound_at).getTime();
  const saida = l.last_outbound_at ? new Date(l.last_outbound_at).getTime() : 0;
  if (saida > entrada) return 0; // já respondida
  return Date.now() - entrada;
}

function formataEspera(ms: number): string {
  const min = Math.floor(ms / MIN);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${min % 60 ? ` ${min % 60}min` : ""}`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "dia" : "dias"}`;
}

/** Faixa de urgência — é o sinal que organiza o trabalho do balcão. */
function faixa(ms: number): { rotulo: string; classe: string; barra: string } {
  const min = ms / MIN;
  if (min < 15) return { rotulo: "recente", classe: "text-emerald-600 dark:text-emerald-400", barra: "bg-emerald-500" };
  if (min < 60) return { rotulo: "esperando", classe: "text-amber-600 dark:text-amber-400", barra: "bg-amber-500" };
  return { rotulo: "atrasada", classe: "text-red-600 dark:text-red-400", barra: "bg-red-500" };
}

function saudacao(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

export default function RecepcaoHome() {
  const { profile } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Fila[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [agora, setAgora] = useState(Date.now());

  useEffect(() => {
    const carregar = async () => {
      // A RLS já limita ao número da unidade desta recepcionista — nenhuma
      // conversa de outra unidade chega aqui, mesmo que a consulta não filtre.
      const desde = new Date(Date.now() - 30 * 24 * 60 * MIN).toISOString();
      const { data } = await supabase
        .from("crm_leads")
        .select("id, name, phone, last_message, last_inbound_at, last_outbound_at")
        .gte("last_message_at", desde)
        .order("last_inbound_at", { ascending: false })
        .limit(200);
      setLeads((data ?? []) as Fila[]);
      setCarregando(false);
    };
    carregar();
    const ch = supabase
      .channel("recepcao-fila")
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_leads" }, carregar)
      .subscribe();
    const tick = window.setInterval(() => setAgora(Date.now()), 30_000);
    return () => { supabase.removeChannel(ch); window.clearInterval(tick); };
  }, []);

  const fila = useMemo(() => {
    void agora; // recalcula a espera a cada tique
    return leads
      .map((l) => ({ l, ms: esperaMs(l) }))
      .filter((x) => x.ms > 0)
      .sort((a, b) => b.ms - a.ms);
  }, [leads, agora]);

  const atrasadas = fila.filter((x) => x.ms >= 60 * MIN).length;
  const respondidasHoje = useMemo(() => {
    const inicioDoDia = new Date(); inicioDoDia.setHours(0, 0, 0, 0);
    return leads.filter((l) => l.last_outbound_at && new Date(l.last_outbound_at) >= inicioDoDia).length;
  }, [leads]);

  const primeiroNome = (profile?.nome ?? "").trim().split(" ")[0] || "";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 pb-10">
        {/* Cabeçalho: quem é, onde está, e o estado do turno em uma linha */}
        <header className="flex flex-wrap items-end justify-between gap-4 pt-1">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Recepção · {tenant.name}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-foreground sm:text-3xl">
              {saudacao()}{primeiroNome ? `, ${primeiroNome}` : ""}
            </h1>
          </div>
          <Link
            to="/crm/conversas"
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-orange transition-opacity hover:opacity-90 gradient-orange"
          >
            <MessageSquare size={16} /> Abrir conversas
          </Link>
        </header>

        {/* Três números que ela realmente controla */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Indicador
            titulo="Esperando resposta"
            valor={fila.length}
            detalhe={fila.length === 1 ? "conversa na fila" : "conversas na fila"}
            destaque={fila.length > 0}
          />
          <Indicador
            titulo="Mais de 1 hora"
            valor={atrasadas}
            detalhe={atrasadas ? "precisam de atenção agora" : "nada atrasado"}
            alerta={atrasadas > 0}
          />
          <Indicador
            titulo="Respondidas hoje"
            valor={respondidasHoje}
            detalhe={respondidasHoje === 1 ? "conversa atendida" : "conversas atendidas"}
          />
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
          {/* Fila por tempo de espera — o coração da tela */}
          <section className="rounded-xl border border-border bg-card shadow-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="font-semibold text-foreground">Fila de atendimento</h2>
                <p className="text-xs text-muted-foreground">Quem esperou mais aparece primeiro</p>
              </div>
              {fila.length > 0 && (
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                  {fila.length}
                </span>
              )}
            </div>

            {carregando ? (
              <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                <Loader2 className="animate-spin" size={16} /> Carregando a fila...
              </div>
            ) : fila.length === 0 ? (
              <div className="px-5 py-16 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                  <MessageSquare className="text-emerald-600 dark:text-emerald-400" size={20} />
                </div>
                <p className="mt-3 font-medium text-foreground">Fila vazia</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ninguém aguardando resposta. Quando chegar mensagem nova, ela aparece aqui.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {fila.slice(0, 12).map(({ l, ms }) => {
                  const f = faixa(ms);
                  return (
                    <li key={l.id}>
                      <button
                        onClick={() => navigate(`/crm/conversa/${l.id}`)}
                        className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/60"
                      >
                        <span className={`h-9 w-1 shrink-0 rounded-full ${f.barra}`} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-foreground">
                            {l.name || l.phone || "Sem nome"}
                          </span>
                          <span className="block truncate text-sm text-muted-foreground">
                            {l.last_message || "—"}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className={`block text-sm font-semibold tabular-nums ${f.classe}`}>
                            {formataEspera(ms)}
                          </span>
                          <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                            {f.rotulo}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {fila.length > 12 && (
              <div className="border-t border-border px-5 py-3">
                <Link to="/crm/conversas" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                  Ver todas as {fila.length} conversas <ArrowRight size={14} />
                </Link>
              </div>
            )}
          </section>

          {/* Atalhos do dia a dia */}
          <aside className="space-y-3">
            <p className="px-1 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Atalhos
            </p>
            <Atalho to="/crm" icone={LayoutGrid} titulo="Funil" descricao="Acompanhar os atendimentos" />
            <Atalho to="/crm/campanhas" icone={Send} titulo="Transmissão" descricao="Enviar aviso para vários pacientes" />
            <Atalho to="/crm/modelos" icone={FileText} titulo="Modelos" descricao="Mensagens prontas aprovadas" />
            <Atalho to="/crm/conexoes" icone={Link2} titulo="Conexões" descricao="Status do WhatsApp da unidade" />
          </aside>
        </div>
      </div>
    </div>
  );
}

function Indicador({
  titulo, valor, detalhe, destaque, alerta,
}: { titulo: string; valor: number; detalhe: string; destaque?: boolean; alerta?: boolean }) {
  return (
    <div
      className={`rounded-xl border bg-card p-5 shadow-card transition-colors ${
        alerta && valor > 0 ? "border-red-500/40" : destaque && valor > 0 ? "border-primary/40" : "border-border"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{titulo}</p>
      <p
        className={`mt-2 text-4xl font-bold tabular-nums ${
          alerta && valor > 0 ? "text-red-600 dark:text-red-400" : "text-foreground"
        }`}
      >
        {valor}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{detalhe}</p>
    </div>
  );
}

function Atalho({
  to, icone: Icone, titulo, descricao,
}: { to: string; icone: any; titulo: string; descricao: string }) {
  return (
    <Link
      to={to}
      className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-card transition-colors hover:border-primary/40 hover:bg-muted/40"
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icone size={17} />
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-foreground">{titulo}</span>
        <span className="block text-xs text-muted-foreground">{descricao}</span>
      </span>
    </Link>
  );
}
