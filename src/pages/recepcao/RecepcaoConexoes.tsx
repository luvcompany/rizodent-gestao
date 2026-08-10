import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import WhatsAppEmbeddedSignupButton from "@/components/integrations/WhatsAppEmbeddedSignupButton";
import { CheckCircle2, AlertCircle, Loader2, Smartphone, Plus } from "lucide-react";

/**
 * Conexões da Recepção — versão enxuta da tela de Integrações.
 *
 * Diferença essencial para a tela dos outros perfis: aqui NÃO passa credencial.
 * Os dados vêm da função `integracoes_visiveis()`, que devolve só nome, número e
 * status — o access_token da Meta fica no servidor. A leitura direta da tabela
 * `integrations` está bloqueada para este perfil.
 *
 * Segue o mesmo sistema visual da tela de Início da recepção: cartão claro com
 * canto 16px, ícone em quadrado pastel e status como pílula.
 */

type Conexao = {
  id: string;
  key: string;
  status: string | null;
  display_name: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  criado_em: string | null;
};

const rotuloStatus = (s: string | null) => {
  if (s === "connected") return { texto: "Conectado", ok: true };
  if (s === "disabled") return { texto: "Desativado", ok: false };
  return { texto: s || "Pendente", ok: false };
};

export default function RecepcaoConexoes() {
  const [conexoes, setConexoes] = useState<Conexao[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    const { data } = await (supabase as any).rpc("integracoes_visiveis");
    setConexoes((data ?? []) as Conexao[]);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const conectadas = conexoes.filter((c) => c.status === "connected");

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[780px] flex-col gap-5 pb-10">

        <header>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Conexões</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            O WhatsApp por onde esta unidade fala com os pacientes.
          </p>
        </header>

        {carregando ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-20 text-muted-foreground shadow-sm">
            <Loader2 className="animate-spin" size={16} /> Verificando conexões...
          </div>
        ) : conexoes.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card px-6 py-12 text-center shadow-sm">
            <div className="mx-auto grid h-[52px] w-[52px] place-items-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
              <Smartphone size={24} />
            </div>
            <h2 className="mt-3.5 text-base font-bold tracking-tight text-foreground">
              Nenhum WhatsApp conectado
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
              Conecte o número da unidade para receber e responder as mensagens dos pacientes por aqui.
              Escolha a opção que mantém o número no celular se a equipe usa os grupos internos.
            </p>
            <div className="mx-auto mt-6 flex max-w-xs flex-col items-stretch gap-2">
              <WhatsAppEmbeddedSignupButton onConnected={carregar} coexistence />
              <WhatsAppEmbeddedSignupButton onConnected={carregar} />
            </div>
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {conexoes.map((c) => {
                const st = rotuloStatus(c.status);
                return (
                  <li
                    key={c.id}
                    className="flex items-center gap-3.5 rounded-2xl border border-border bg-card p-[18px] shadow-sm"
                  >
                    <span
                      className={`grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[13px] ${
                        st.ok
                          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
                          : "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
                      }`}
                    >
                      <Smartphone size={21} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold tracking-tight text-foreground">
                        {c.display_name || "WhatsApp da unidade"}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[12.5px] tabular-nums text-muted-foreground">
                        {c.phone_number_id ? `Número ${c.phone_number_id}` : "Número não identificado"}
                      </span>
                    </span>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold ${
                        st.ok
                          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
                          : "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
                      }`}
                    >
                      {st.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                      {st.texto}
                    </span>
                  </li>
                );
              })}
            </ul>

            <div className="rounded-2xl border border-dashed border-border p-[18px]">
              <div className="flex items-center gap-2.5">
                <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-muted text-muted-foreground">
                  <Plus size={17} />
                </span>
                <div>
                  <p className="text-[14.5px] font-semibold tracking-tight text-foreground">Conectar outro número</p>
                  <p className="text-[12.5px] text-muted-foreground">
                    Use quando esta unidade for atender por um número diferente.
                  </p>
                </div>
              </div>
              <div className="mt-3.5 flex flex-wrap gap-2">
                <WhatsAppEmbeddedSignupButton onConnected={carregar} coexistence />
                <WhatsAppEmbeddedSignupButton onConnected={carregar} />
              </div>
            </div>
          </>
        )}

        {conectadas.length > 0 && (
          <p className="px-1 text-[12.5px] leading-relaxed text-muted-foreground">
            As mensagens enviadas pelo celular também aparecem aqui quando o número está no modo que
            mantém o WhatsApp no aparelho.
          </p>
        )}
      </div>
    </div>
  );
}
