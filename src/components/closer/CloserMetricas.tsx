import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CalendarDays, Coins, TrendingUp, Trophy } from "lucide-react";
import { hojeNaClinica } from "@/lib/moeda";

/**
 * Números do closer na tela de Início. Vêm da RPC closer_dashboard_metrics,
 * que soma apenas closer_pagamentos/closer_pacientes — o universo dele, nunca o
 * faturamento da clínica. Faturamento conta pela DATA DO PAGAMENTO e
 * "fechamentos" conta pacientes com pagamento registrado — sem dinheiro
 * lançado não é fechamento, e assim o número nunca contradiz o faturamento.
 */

type Metricas = {
  faturamento_dia: number;
  faturamento_mes: number;
  faturamento_total: number;
  previsao_mes: number;
  fechamentos_mes: number;
  fechamentos_total: number;
};

const brl = (v: number) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default function CloserMetricas() {
  const [m, setM] = useState<Metricas | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let vivo = true;

    const buscar = async () => {
      const { data, error } = await (supabase as any).rpc("closer_dashboard_metrics", {
        p_mes: hojeNaClinica().slice(0, 8) + "01",
      });
      if (!vivo) return;
      // Erro não pode virar R$ 0,00: um mês sem venda e uma falha de rede
      // ficariam idênticos na tela, e o closer concluiria que o sistema
      // perdeu o trabalho dele.
      if (error) { setFalhou(true); return; }
      setFalhou(false);
      setM(data as Metricas);
    };

    void buscar();
    // Lançou um pagamento na conversa e voltou para o Início: os números
    // precisam acompanhar, sem depender de recarregar a página.
    const aoVoltar = () => { if (document.visibilityState === "visible") void buscar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
    return () => {
      vivo = false;
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoVoltar);
    };
  }, []);

  // Erro não vira R$ 0 em lugar nenhum (AGENDA-22/CLO-14): com a RPC
  // falhando, os quatro cartões mostram "—" e dizem que não carregaram —
  // inclusive as linhas de apoio (previsão e total de fechamentos), que antes
  // continuavam dizendo "previsão R$ 0" e "0 no total". Enquanto a primeira
  // resposta não chega, também não há número.
  const carregando = !m && !falhou;
  const semDado = falhou || carregando;
  const apoioDe = (texto: string) =>
    falhou ? "não foi possível carregar" : carregando ? "carregando…" : texto;

  const cartoes = [
    {
      rotulo: "Hoje",
      valor: semDado ? "—" : brl(m?.faturamento_dia ?? 0),
      apoio: apoioDe("faturamento do dia"),
      Icone: Coins,
      cor: "text-success",
      fundo: "bg-success-soft",
    },
    {
      rotulo: "No mês",
      valor: semDado ? "—" : brl(m?.faturamento_mes ?? 0),
      apoio: apoioDe(`previsão ${brl(m?.previsao_mes ?? 0)}`),
      Icone: TrendingUp,
      cor: "text-info",
      fundo: "bg-info-soft",
    },
    {
      rotulo: "Total",
      valor: semDado ? "—" : brl(m?.faturamento_total ?? 0),
      apoio: apoioDe("desde o início"),
      Icone: CalendarDays,
      cor: "text-purple",
      fundo: "bg-purple-soft",
    },
    {
      rotulo: "Fechamentos",
      valor: semDado ? "—" : String(m?.fechamentos_mes ?? 0),
      apoio: apoioDe(`${m?.fechamentos_total ?? 0} no total`),
      Icone: Trophy,
      cor: "text-warning",
      fundo: "bg-warning-soft",
    },
  ];

  return (
    <section className="grid grid-cols-1 gap-5 min-[480px]:grid-cols-2 xl:grid-cols-4">
      {cartoes.map(({ rotulo, valor, apoio, Icone, cor, fundo }) => (
        // Mesmo desenho dos indicadores do Início (RecepcaoHome): rótulo à
        // esquerda, chip de ícone em quadrado pastel à direita, número grande.
        <div key={rotulo} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 rounded-card border border-border/60 bg-card p-5 shadow-card">
          <div className="contents">
            <span className={`col-start-2 row-start-1 grid h-11 w-11 shrink-0 place-items-center justify-self-end rounded-xl ${fundo} ${cor}`}>
              <Icone size={21} />
            </span>
            <span className="col-start-1 row-start-1 block pt-0.5 text-[13.5px] font-medium leading-snug text-muted-foreground">
              {rotulo}
            </span>
          </div>
          <div className="col-span-2 mt-3 text-[30px] font-bold leading-none tracking-tight tabular-nums text-foreground [overflow-wrap:anywhere]">{valor}</div>
          <div className="col-span-2 mt-2 text-xs text-tertiary">{apoio}</div>
        </div>
      ))}
    </section>
  );
}
