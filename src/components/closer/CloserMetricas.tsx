import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CalendarDays, Coins, TrendingUp, Trophy } from "lucide-react";
import { hojeNaClinica } from "@/lib/moeda";

/**
 * Números do closer na tela de Início. Vêm da RPC closer_dashboard_metrics,
 * que soma apenas closer_pagamentos/closer_pacientes — o universo dele, nunca o
 * faturamento da clínica. Faturamento conta pela DATA DO PAGAMENTO e
 * "fechamentos" é a quantidade de pacientes vinculados.
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

  const cartoes = [
    {
      rotulo: "Hoje",
      valor: falhou ? "—" : brl(m?.faturamento_dia ?? 0),
      apoio: falhou ? "não foi possível carregar" : "faturamento do dia",
      Icone: Coins,
      cor: "text-emerald-600",
      fundo: "bg-emerald-500/10",
    },
    {
      rotulo: "No mês",
      valor: falhou ? "—" : brl(m?.faturamento_mes ?? 0),
      apoio: `previsão ${brl(m?.previsao_mes ?? 0)}`,
      Icone: TrendingUp,
      cor: "text-sky-600",
      fundo: "bg-sky-500/10",
    },
    {
      rotulo: "Total",
      valor: falhou ? "—" : brl(m?.faturamento_total ?? 0),
      apoio: "desde o início",
      Icone: CalendarDays,
      cor: "text-violet-600",
      fundo: "bg-violet-500/10",
    },
    {
      rotulo: "Fechamentos",
      valor: falhou ? "—" : String(m?.fechamentos_mes ?? 0),
      apoio: `${m?.fechamentos_total ?? 0} no total`,
      Icone: Trophy,
      cor: "text-amber-600",
      fundo: "bg-amber-500/10",
    },
  ];

  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cartoes.map(({ rotulo, valor, apoio, Icone, cor, fundo }) => (
        <div key={rotulo} className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <span className={`grid h-8 w-8 place-items-center rounded-lg ${fundo} ${cor}`}>
              <Icone size={16} />
            </span>
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {rotulo}
            </span>
          </div>
          <div className="mt-2.5 text-2xl font-semibold tabular-nums text-foreground">{valor}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{apoio}</div>
        </div>
      ))}
    </section>
  );
}
