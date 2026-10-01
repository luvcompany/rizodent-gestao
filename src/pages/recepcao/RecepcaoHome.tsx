import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import CloserMetricas from "@/components/closer/CloserMetricas";
import SdrExpediente from "@/components/sdr/SdrExpediente";
import { rotuloDesfecho } from "@/lib/desfechoLabel";
import { KpiCard, PageHeader } from "@/components/crm-ui";

import {
  MessageSquare, Send, FileText, Zap, Bot, Users, Clock, CheckCircle2,
  CalendarDays, Loader2,
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
 *
 * Reuso: o closer (/crm/closer) e a SDR do rodízio (/crm/sdr) montam ESTA
 * mesma tela — o banco decide o que cada uma vê (closer: seu número; SDR: os
 * leads de que é dona). Só os atalhos mudam por papel, porque o menu da SDR
 * não tem Transmissão (o que ela não alcança não vira atalho).
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

/**
 * Consulta que já passou da hora e continua sem ninguém dizer se o paciente
 * veio. Desde 17/09/2026 NENHUM robô decide isso (o dono desligou a passada
 * automática do Dontus, que marcava falta pelo relógio e errou 13 dos 61 casos
 * de setembro). Quem marca é a SDR — então ela precisa ver a lista, senão a
 * consulta fica sem desfecho e o relatório dela some com o comparecimento.
 */
type PresencaPendente = {
  id: string;
  lead_id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  lead_name: string | null;
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

function saudacao(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

export default function RecepcaoHome() {
  const { profile, userRole } = useAuth();
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Fila[]>([]);
  const [consultas, setConsultas] = useState<Consulta[]>([]);
  const [conectado, setConectado] = useState<boolean | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [agora, setAgora] = useState(Date.now());
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [presencas, setPresencas] = useState<PresencaPendente[]>([]);

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
        // Só consulta que ainda vai acontecer: cancelada, remarcada ou já com
        // desfecho (compareceu/faltou/fechou) não é "consulta de hoje" — antes
        // um agendamento cancelado continuava na lista pedindo confirmação.
        supabase
          .from("crm_appointments")
          .select("id, scheduled_time, status, lead_name, notes")
          .eq("scheduled_date", dia)
          .not("status", "in", "(cancelled,rescheduled,no_show,contracted,not_contracted)")
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

  // Presença para marcar — só da SDR. A RLS (sdr_escopo_crm_appointments) já
  // limita às consultas dos leads dela; o filtro por papel evita montar a
  // consulta para quem não marca presença (recepção e closer).
  useEffect(() => {
    if (userRole !== "sdr") { setPresencas([]); return; }
    let vivo = true;
    const carregarPresencas = async () => {
      const hoje = new Date();
      const iso = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const desde = new Date(hoje.getTime() - 7 * 24 * 60 * MIN);
      const { data } = await supabase
        .from("crm_appointments")
        .select("id, lead_id, scheduled_date, scheduled_time, lead_name")
        .in("status", ["confirmed", "pending"])
        .gte("scheduled_date", iso(desde))
        .lte("scheduled_date", iso(hoje))
        .order("scheduled_date", { ascending: false })
        .limit(50);
      if (!vivo) return;
      const agora = Date.now();
      // Só o que JÁ ACONTECEU: consulta das 15h não entra na lista às 9h.
      setPresencas(
        ((data ?? []) as PresencaPendente[]).filter((c) => {
          const hora = (c.scheduled_time ?? "23:59").slice(0, 5);
          return new Date(`${c.scheduled_date}T${hora}:00`).getTime() <= agora;
        }),
      );
    };
    carregarPresencas();
    const t = window.setInterval(carregarPresencas, 5 * MIN);
    return () => { vivo = false; window.clearInterval(t); };
  }, [userRole]);

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

  /** Confirma a presença sem sair do Início — antes só dava para fazer isso
   *  dentro da conversa, e a tela cobrava a confirmação sem oferecer o botão. */
  const confirmarConsulta = async (id: string) => {
    setConfirmando(id);
    // Update barrado pela RLS não devolve erro — devolve sucesso com ZERO
    // linhas. O `.select()` torna a resposta verificável; sem ele o cartão
    // aparecia como confirmado e voltava a "a confirmar" no próximo
    // carregamento.
    const { data, error } = await supabase
      .from("crm_appointments")
      .update({ status: "confirmed" })
      .eq("id", id)
      .select("id");
    setConfirmando(null);
    if (error) {
      toast.error("Não foi possível confirmar: " + error.message);
      return;
    }
    if (!data || data.length === 0) {
      toast.error("Seu perfil não tem permissão para confirmar esta consulta.");
      return;
    }
    setConsultas((prev) => prev.map((c) => (c.id === id ? { ...c, status: "confirmed" } : c)));
    toast.success("Presença confirmada");
  };

  const semConfirmar = consultas.filter((c) => c.status !== "confirmed").length;
  const primeiroNome = (profile?.nome ?? "").trim().split(/\s+/)[0] ?? "";
  // A SDR não tem Transmissão no escopo dela (ProtectedRoute/CrmLayout): o
  // atalho e o "Enviar lembrete" a levariam para uma rota que a devolve ao Início.
  const temTransmissao = userRole !== "sdr";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-5 pb-10">

        {/* cabeçalho */}
        <PageHeader
          title={`${saudacao()}${primeiroNome ? `, ${primeiroNome}` : ""} 👋`}
          subtitle={new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
          actions={
          <>
            {/* O closer trabalha dentro das conversas o dia todo: o aviso de
                conexão e o atalho para abrir conversas viram ruído aqui.
                O sino não é repetido: o cabeçalho do CRM, logo acima, já traz o
                sino de verdade — e dois deles disputariam o mesmo canal de
                tempo real, o que derrubava a tela inteira. */}
            {/* SDR não lê a tabela de conexões (RLS): o chip diria "desconectado"
                mesmo com tudo ligado — some para ela. */}
            {userRole !== "closer" && userRole !== "sdr" && (
              <span className="hidden h-10 items-center gap-2 rounded-control border border-border/60 bg-card px-3.5 text-[13px] font-medium shadow-card sm:flex">
                <span className={`h-2 w-2 shrink-0 rounded-full ${conectado === false ? "bg-destructive" : "bg-success"}`} />
                {conectado === false ? "WhatsApp desconectado" : "WhatsApp conectado"}
              </span>
            )}
            {userRole !== "closer" && (
              <Link
                to="/crm/conversas"
                className="flex h-10 items-center gap-2 rounded-control bg-primary px-4 text-[13.5px] font-semibold text-primary-foreground shadow-primary transition-opacity hover:opacity-90"
              >
                <MessageSquare size={16} /> Abrir conversas
              </Link>
            )}
          </>}
        />

        {/* Faturamento do closer — só para ele; a recepção não lança pagamentos. */}
        {userRole === "closer" && <CloserMetricas />}

        {/* Ponto de expediente da SDR (Fase 2 do rodízio) — só para ela: a
            recepção e o closer não batem ponto aqui. */}
        {userRole === "sdr" && <SdrExpediente />}

        {/* indicadores */}
        <section className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          <KpiCard icon={Users} tone="info" label="Esperando resposta" value={fila.length} detail={fila.length === 1 ? "conversa na fila" : "conversas na fila"} />
          <KpiCard icon={Clock} tone="warning" label="Mais de 1 hora" value={atrasadas} detail={atrasadas ? "precisam de atenção" : "nada atrasado"} />
          <KpiCard icon={CheckCircle2} tone="success" label="Respondidas hoje" value={respondidasHoje} detail={respondidasHoje === 1 ? "conversa atendida" : "conversas atendidas"} />
        </section>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,340px)]">

          {/* fila */}
          <section className="overflow-hidden rounded-card border border-border/60 bg-card shadow-card">
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
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success-soft">
                  <CheckCircle2 className="text-success-soft-foreground" size={22} />
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
                          onClick={() => navigate(`/crm/conversas?lead=${l.id}`)}
                          className="relative grid w-full grid-cols-[42px_1fr_auto] items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted/60"
                        >
                          {atrasada && (
                            <span className="absolute bottom-3 left-0 top-3 w-[3px] rounded-r bg-primary" aria-hidden />
                          )}
                          <span className="relative grid h-[42px] w-[42px] place-items-center rounded-full bg-primary-soft text-[13px] font-bold text-primary-soft-foreground">
                            {iniciais(l.name, l.phone)}
                            <span className="absolute -bottom-px -right-px h-[15px] w-[15px] rounded-full border-[2.5px] border-card bg-[#25D366]" />
                          </span>
                          <span className="min-w-0">
                            <span className="line-clamp-2 break-words text-[14.5px] font-semibold leading-snug text-foreground">
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
            {presencas.length > 0 && (
              <section className="overflow-hidden rounded-card border border-warning/40 bg-warning-soft shadow-card">
                <div className="flex items-center gap-2.5 px-[18px] pb-3 pt-[17px]">
                  <span className="grid h-[34px] w-[34px] place-items-center rounded-control bg-warning text-warning-foreground">
                    <CheckCircle2 size={16} />
                  </span>
                  <h2 className="text-base font-bold tracking-tight text-foreground">Marcar presença</h2>
                  <span className="ml-auto rounded-full bg-warning px-2.5 py-0.5 text-[12px] font-bold text-warning-foreground">
                    {presencas.length}
                  </span>
                </div>
                <p className="px-[18px] pb-2 text-[12.5px] text-muted-foreground">
                  Estas consultas já aconteceram e ninguém disse se o paciente veio. Abra a conversa e
                  registre "Compareceu" ou "Não compareceu" — o sistema não decide mais isso sozinho.
                </p>
                <ul className="px-[18px] pb-4">
                  {presencas.slice(0, 8).map((c, i) => (
                    <li
                      key={c.id}
                      className={`grid grid-cols-[76px_minmax(0,1fr)] items-center gap-3 py-3 sm:grid-cols-[76px_minmax(0,1fr)_auto] ${i > 0 ? "border-t border-warning/20" : ""}`}
                    >
                      <span className="font-mono text-[12.5px] font-semibold tabular-nums text-muted-foreground">
                        {c.scheduled_date.slice(8, 10)}/{c.scheduled_date.slice(5, 7)}{" "}
                        {(c.scheduled_time ?? "").slice(0, 5)}
                      </span>
                      <span className="break-words text-sm font-semibold text-foreground">
                        {c.lead_name || "Sem nome"}
                      </span>
                      <button
                        type="button"
                        onClick={() => navigate(`/crm/conversa/${c.lead_id}`)}
                        className="col-span-2 h-9 whitespace-nowrap rounded-control bg-primary px-3 text-[11.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:col-span-1"
                      >
                        Marcar
                      </button>
                    </li>
                  ))}
                </ul>
                {presencas.length > 8 && (
                  <div className="border-t border-warning/20 px-[18px] py-3 text-[12.5px] text-muted-foreground">
                    e mais {presencas.length - 8} consulta(s) esperando.
                  </div>
                )}
              </section>
            )}

            <section className="overflow-hidden rounded-card border border-border/60 bg-card shadow-card">
              <div className="flex items-center gap-2.5 px-[18px] pb-3 pt-[17px]">
                <span className="grid h-[34px] w-[34px] place-items-center rounded-control bg-info-soft text-info-soft-foreground">
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
                    // A consulta desta lista nasce 'pending' ou 'confirmed' (a
                    // busca já exclui cancelada, remarcada e as com desfecho).
                    // Nesses dois casos o texto continua o mesmo de sempre —
                    // "Sem confirmação" é uma cobrança de ação da recepção, não o
                    // nome do estado. Qualquer outro status passa pelo helper de
                    // papel, que devolve "Compareceu" para a SDR nos dois
                    // desfechos de comparecimento (decisão D3) em vez de deixar
                    // um "não contratado" aparecer como "Sem confirmação".
                    const pendente = !c.status || c.status === "pending";
                    const rotulo = confirmada
                      ? "Confirmado"
                      : pendente
                      ? "Sem confirmação"
                      : rotuloDesfecho(c.status, userRole);
                    return (
                      <li
                        key={c.id}
                        className={`grid grid-cols-[52px_1fr_auto] items-center gap-3 py-3 ${i > 0 ? "border-t border-border" : ""}`}
                      >
                        <span className={`font-mono text-[13px] font-semibold tabular-nums ${confirmada ? "text-muted-foreground" : "text-primary"}`}>
                          {(c.scheduled_time ?? "").slice(0, 5)}
                        </span>
                        <span className="break-words text-sm font-semibold leading-snug text-foreground">
                          {c.lead_name || "Sem nome"}
                        </span>
                        <span
                          className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${
                            confirmada
                              ? "bg-success-soft text-success-soft-foreground"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {rotulo}
                        </span>
                        {!confirmada && (
                          <button
                            type="button"
                            onClick={() => confirmarConsulta(c.id)}
                            disabled={confirmando === c.id}
                            className="whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-[11.5px] font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                          >
                            {confirmando === c.id ? "..." : "Confirmar"}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {semConfirmar > 0 && (
                <div className="border-t border-border px-[18px] py-3.5 text-[13px] text-muted-foreground">
                  {semConfirmar === 1 ? "Uma pessoa ainda não confirmou." : `${semConfirmar} pessoas ainda não confirmaram.`}
                  {temTransmissao && (
                    <Link to="/crm/campanhas" className="mt-0.5 block font-semibold text-primary hover:underline">
                      Enviar lembrete
                    </Link>
                  )}
                </div>
              )}
            </section>

            <section className="overflow-hidden rounded-card border border-border/60 bg-card shadow-card">
              <div className="px-[18px] pb-3 pt-[17px]">
                <h2 className="text-base font-bold tracking-tight text-foreground">Atalhos rápidos</h2>
              </div>
              <div className="grid grid-cols-2 gap-2 px-3 pb-4 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                {temTransmissao ? (
                  <Atalho to="/crm/campanhas" icone={<Send size={19} />} tom="bg-success-soft text-success-soft-foreground" rotulo="Transmissão" />
                ) : (
                  <Atalho to="/crm/calendario" icone={<CalendarDays size={19} />} tom="bg-success-soft text-success-soft-foreground" rotulo="Calendário" />
                )}
                <Atalho to="/crm/modelos" icone={<FileText size={19} />} tom="bg-purple-soft text-purple-soft-foreground" rotulo="Modelos" />
                <Atalho to="/crm/respostas-rapidas" icone={<Zap size={19} />} tom="bg-warning-soft text-warning-soft-foreground" rotulo="Respostas" />
                <Atalho to="/crm/bots" icone={<Bot size={19} />} tom="bg-info-soft text-info-soft-foreground" rotulo="Bots" />
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Atalho({ to, icone, tom, rotulo }: { to: string; icone: React.ReactNode; tom: string; rotulo: string }) {
  return (
    <Link
      to={to}
      className="flex min-w-0 flex-col items-center gap-2 rounded-control border border-transparent px-1.5 py-3.5 text-center text-[11.5px] font-medium leading-tight text-muted-foreground transition-colors hover:border-border/60 hover:bg-surface-sunken hover:text-foreground"
    >
      <span className={`grid h-[42px] w-[42px] place-items-center rounded-xl ${tom}`}>{icone}</span>
      <span className="max-w-full break-words">{rotulo}</span>
    </Link>
  );
}
