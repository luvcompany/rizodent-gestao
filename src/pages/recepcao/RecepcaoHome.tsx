import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  MessageSquare, Send, FileText, Zap, Bot, Users, Clock, CheckCircle2,
  CalendarDays, Bell, Loader2,
} from "lucide-react";

/**
 * Início do perfil Recepção — uma "estação de balcão", não um painel de gestão.
 *
 * O trabalho de quem está na recepção é: quem está esperando resposta e há
 * quanto tempo. Por isso a tela é organizada pelo TEMPO DE ESPERA, e não por
 * métricas de venda (que este perfil nem alcança).
 *
 * Sistema visual: cartões sobre fundo neutro, ícone em quadrado pastel por
 * indicador — a cor CLASSIFICA o estado (espera, atenção, concluído), enquanto
 * a cor da MARCA (primary) vem do painel e muda por cliente. Por isso os pastéis
 * são fixos e o primary é variável: se ambos mudassem, o significado se perderia.
 *
 * Isolamento: rota e componentes exclusivos do papel `recepcao`. Nenhuma tela
 * compartilhada com os outros perfis é alterada, e as consultas são filtradas
 * pelo banco (a recepção só alcança o número da sua unidade).
 */

type Fila = {
  id: string;
  name: string | null;
  phone: string | null;
  last_message: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
};

type Consulta = {
  id: string;
  scheduled_time: string | null;
  status: string | null;
  lead_name: string | null;
  notes: string | null;
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
  const resto = min % 60;
  if (h < 24) return `${h}h${String(resto).padStart(2, "0")}`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "dia" : "dias"}`;
}

function iniciais(nome: string | null, tel: string | null): string {
  const limpo = (nome ?? "").trim();
  if (!limpo) return (tel ?? "?").slice(-2);
  const partes = limpo.split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}

/** Paleta fixa dos avatares — estável por pessoa (mesma inicial, mesma cor). */
const TONS = [
  "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400",
  "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
  "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  "bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400",
  "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
];
const tomDe = (chave: string) => {
  let h = 0;
  for (let i = 0; i < chave.length; i++) h = (h * 31 + chave.charCodeAt(i)) % 997;
  return TONS[h % TONS.length];
};

function saudacao(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

/** Mini-gráfico das últimas 8 horas — desenhado a partir dos próprios dados. */
function Spark({ pontos, cor }: { pontos: number[]; cor: string }) {
  if (pontos.length < 2) return null;
  const max = Math.max(...pontos, 1);
  const passo = 82 / (pontos.length - 1);
  const y = (v: number) => 30 - (v / max) * 24;
  const linha = pontos.map((v, i) => `${i === 0 ? "M" : "L"}${(i * passo).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 82 34" preserveAspectRatio="none" className="ml-auto hidden h-8 w-20 shrink-0 xl:block" aria-hidden="true">
      <path d={`${linha} L82 34 L0 34 Z`} fill={cor} opacity="0.14" />
      <path d={linha} fill="none" stroke={cor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RecepcaoHome() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Fila[]>([]);
  const [consultas, setConsultas] = useState<Consulta[]>([]);
  const [conectado, setConectado] = useState<boolean | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [agora, setAgora] = useState(Date.now());

  useEffect(() => {
    const carregar = async () => {
      const desde = new Date(Date.now() - 30 * 24 * 60 * MIN).toISOString();
      const hoje = new Date();
      const dia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;

      // A RLS já limita ao número da unidade desta recepcionista — nenhuma
      // conversa de outra unidade chega aqui, mesmo sem filtro na consulta.
      const [{ data: ls }, { data: ags }, { data: cx }] = await Promise.all([
        supabase
          .from("crm_leads")
          .select("id, name, phone, last_message, last_inbound_at, last_outbound_at")
          .gte("last_message_at", desde)
          .order("last_inbound_at", { ascending: false })
          .limit(200),
        supabase
          .from("crm_appointments")
          .select("id, scheduled_time, status, lead_name, notes")
          .eq("scheduled_date", dia)
          .order("scheduled_time", { ascending: true })
          .limit(12),
        (supabase as any).rpc("integracoes_visiveis"),
      ]);

      setLeads((ls ?? []) as Fila[]);
      setConsultas((ags ?? []) as Consulta[]);
      setConectado(((cx ?? []) as any[]).some((c) => c.status === "connected"));
      setCarregando(false);
    };
    carregar();
    const ch = supabase
      .channel("recepcao-inicio")
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
    const inicio = new Date(); inicio.setHours(0, 0, 0, 0);
    return leads.filter((l) => l.last_outbound_at && new Date(l.last_outbound_at) >= inicio).length;
  }, [leads]);

  /** Entradas por hora nas últimas 8 h — alimenta os mini-gráficos. */
  const porHora = useMemo(() => {
    const balde = new Array(8).fill(0);
    const agoraH = new Date();
    leads.forEach((l) => {
      if (!l.last_inbound_at) return;
      const dif = (agoraH.getTime() - new Date(l.last_inbound_at).getTime()) / 3_600_000;
      if (dif >= 0 && dif < 8) balde[7 - Math.floor(dif)] += 1;
    });
    return balde;
  }, [leads]);

  const semConfirmar = consultas.filter((c) => c.status !== "confirmed").length;
  const primeiroNome = (profile?.nome ?? "").trim().split(/\s+/)[0] ?? "";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-5 pb-10">

        {/* cabeçalho */}
        <header className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-[25px]">
              {saudacao()}{primeiroNome ? `, ${primeiroNome}` : ""} 👋
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2.5">
            <span className="hidden items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2 text-[13px] font-medium shadow-sm sm:flex">
              <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${conectado === false ? "bg-red-500" : "bg-emerald-500"}`} />
              {conectado === false ? "WhatsApp desconectado" : "WhatsApp conectado"}
            </span>
            <span className="relative grid h-[38px] w-[38px] place-items-center rounded-xl border border-border bg-card text-muted-foreground shadow-sm">
              <Bell size={17} />
              {atrasadas > 0 && (
                <i className="absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold not-italic text-white">
                  {atrasadas}
                </i>
              )}
            </span>
            <Link
              to="/crm/conversas"
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[13.5px] font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
            >
              <MessageSquare size={16} /> Abrir conversas
            </Link>
          </div>
        </header>

        {/* indicadores */}
        <section className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          <Indicador
            icone={<Users size={21} />}
            tom="bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400"
            rotulo="Esperando resposta"
            valor={fila.length}
            detalhe={fila.length === 1 ? "conversa na fila" : "conversas na fila"}
            pontos={porHora}
            cor="rgb(99 102 241)"
          />
          <Indicador
            icone={<Clock size={21} />}
            tom="bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
            rotulo="Mais de 1 hora"
            valor={atrasadas}
            detalhe={atrasadas ? "precisam de atenção" : "nada atrasado"}
            pontos={porHora}
            cor="rgb(245 158 11)"
          />
          <Indicador
            icone={<CheckCircle2 size={21} />}
            tom="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
            rotulo="Respondidas hoje"
            valor={respondidasHoje}
            detalhe={respondidasHoje === 1 ? "conversa atendida" : "conversas atendidas"}
            pontos={porHora}
            cor="rgb(16 185 129)"
          />
        </section>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_340px]">

          {/* fila */}
          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex items-center gap-3 px-[18px] pb-3 pt-[17px]">
              <div>
                <h2 className="text-base font-bold tracking-tight text-foreground">Fila de atendimento</h2>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">Quem esperou mais primeiro</p>
              </div>
              <Link
                to="/crm/conversas"
                className="ml-auto rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:text-foreground"
              >
                Ver todas
              </Link>
            </div>

            {carregando ? (
              <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
                <Loader2 className="animate-spin" size={16} /> Carregando a fila...
              </div>
            ) : fila.length === 0 ? (
              <div className="px-6 py-20 text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-50 dark:bg-emerald-500/15">
                  <CheckCircle2 className="text-emerald-600 dark:text-emerald-400" size={22} />
                </div>
                <p className="mt-3 font-semibold text-foreground">Nenhuma conversa esperando</p>
                <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
                  Quando chegar mensagem nova, ela aparece aqui em ordem de espera.
                </p>
              </div>
            ) : (
              <>
                <ul className="px-1.5 pb-1.5">
                  {fila.slice(0, 8).map(({ l, ms }, i) => {
                    const atrasada = ms >= 60 * MIN;
                    return (
                      <li key={l.id} className={i > 0 ? "border-t border-border" : ""}>
                        <button
                          onClick={() => navigate(`/crm/conversa/${l.id}`)}
                          className="relative grid w-full grid-cols-[42px_1fr_auto] items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted/60"
                        >
                          {atrasada && (
                            <span className="absolute bottom-3 left-0 top-3 w-[3px] rounded-r bg-primary" aria-hidden />
                          )}
                          <span className={`relative grid h-[42px] w-[42px] place-items-center rounded-full text-[13px] font-bold ${tomDe(l.id)}`}>
                            {iniciais(l.name, l.phone)}
                            <span className="absolute -bottom-px -right-px h-[15px] w-[15px] rounded-full border-[2.5px] border-card bg-[#25D366]" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[14.5px] font-semibold tracking-tight text-foreground">
                              {l.name || l.phone || "Sem nome"}
                            </span>
                            <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                              {l.last_message || "—"}
                            </span>
                          </span>
                          <span className={`whitespace-nowrap font-mono text-[13px] font-semibold tabular-nums ${atrasada ? "text-primary" : "text-muted-foreground"}`}>
                            {formataEspera(ms)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {fila.length > 8 && (
                  <div className="px-3 pb-3.5">
                    <Link
                      to="/crm/conversas"
                      className="block rounded-xl border border-border py-2.5 text-center text-[13px] font-medium text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:text-foreground"
                    >
                      Ver as outras {fila.length - 8} conversas
                    </Link>
                  </div>
                )}
              </>
            )}
          </section>

          {/* coluna lateral */}
          <div className="flex flex-col gap-4">
            <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex items-center gap-2.5 px-[18px] pb-3 pt-[17px]">
                <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400">
                  <CalendarDays size={16} />
                </span>
                <h2 className="text-base font-bold tracking-tight text-foreground">Consultas de hoje</h2>
              </div>

              {consultas.length === 0 ? (
                <p className="px-[18px] pb-5 text-[13px] text-muted-foreground">
                  {carregando ? "Carregando..." : "Nenhuma consulta marcada para hoje."}
                </p>
              ) : (
                <ul className="px-[18px] pb-1.5">
                  {consultas.map((c, i) => {
                    const confirmada = c.status === "confirmed";
                    return (
                      <li
                        key={c.id}
                        className={`grid grid-cols-[52px_1fr_auto] items-center gap-3 py-3 ${i > 0 ? "border-t border-border" : ""}`}
                      >
                        <span className={`font-mono text-[13px] font-semibold tabular-nums ${confirmada ? "text-muted-foreground" : "text-primary"}`}>
                          {(c.scheduled_time ?? "").slice(0, 5)}
                        </span>
                        <span className="truncate text-sm font-semibold text-foreground">
                          {c.lead_name || "Sem nome"}
                        </span>
                        <span
                          className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${
                            confirmada
                              ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {confirmada ? "Confirmado" : "Sem confirmação"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}

              {semConfirmar > 0 && (
                <div className="border-t border-border px-[18px] py-3.5 text-[13px] text-muted-foreground">
                  {semConfirmar === 1 ? "Uma pessoa ainda não confirmou." : `${semConfirmar} pessoas ainda não confirmaram.`}
                  <Link to="/crm/campanhas" className="mt-0.5 block font-semibold text-primary hover:underline">
                    Enviar lembrete
                  </Link>
                </div>
              )}
            </section>

            <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="px-[18px] pb-3 pt-[17px]">
                <h2 className="text-base font-bold tracking-tight text-foreground">Atalhos rápidos</h2>
              </div>
              <div className="grid grid-cols-4 gap-2 px-3 pb-4">
                <Atalho to="/crm/campanhas" icone={<Send size={19} />} tom="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400" rotulo="Transmissão" />
                <Atalho to="/crm/modelos" icone={<FileText size={19} />} tom="bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400" rotulo="Modelos" />
                <Atalho to="/crm/respostas-rapidas" icone={<Zap size={19} />} tom="bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400" rotulo="Respostas" />
                <Atalho to="/crm/bots" icone={<Bot size={19} />} tom="bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400" rotulo="Bots" />
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Indicador({
  icone, tom, rotulo, valor, detalhe, pontos, cor,
}: {
  icone: React.ReactNode; tom: string; rotulo: string; valor: number;
  detalhe: string; pontos: number[]; cor: string;
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-border bg-card p-[18px] shadow-sm">
      <span className={`grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[13px] ${tom}`}>{icone}</span>
      <span className="min-w-0">
        <span className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {rotulo}
        </span>
        <span className="mt-0.5 block font-mono text-[27px] font-bold leading-tight tracking-tight tabular-nums text-foreground">
          {valor}
        </span>
        <span className="block text-[12.5px] text-muted-foreground">{detalhe}</span>
      </span>
      <Spark pontos={pontos} cor={cor} />
    </div>
  );
}

function Atalho({ to, icone, tom, rotulo }: { to: string; icone: React.ReactNode; tom: string; rotulo: string }) {
  return (
    <Link
      to={to}
      className="flex flex-col items-center gap-2 rounded-[13px] px-1.5 py-3.5 text-center text-[11.5px] font-medium leading-tight text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
    >
      <span className={`grid h-[42px] w-[42px] place-items-center rounded-xl ${tom}`}>{icone}</span>
      {rotulo}
    </Link>
  );
}
