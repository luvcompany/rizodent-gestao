import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import WhatsAppEmbeddedSignupButton from "@/components/integrations/WhatsAppEmbeddedSignupButton";
import { CheckCircle2, AlertCircle, Loader2, Smartphone } from "lucide-react";

/**
 * Conexões da Recepção — versão enxuta da tela de Integrações.
 *
 * Diferença essencial para a tela dos outros perfis: aqui NÃO passa credencial.
 * Os dados vêm da função `integracoes_visiveis()`, que devolve só nome, número e
 * status — o access_token da Meta fica no servidor. A leitura direta da tabela
 * `integrations` está bloqueada para este perfil.
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
      <div className="mx-auto max-w-3xl space-y-6 pb-10">
        <header className="pt-1">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Recepção</p>
          <h1 className="mt-1 text-2xl font-bold text-foreground">Conexões</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            O WhatsApp por onde esta unidade fala com os pacientes.
          </p>
        </header>

        {carregando ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-16 text-muted-foreground shadow-card">
            <Loader2 className="animate-spin" size={16} /> Verificando conexões...
          </div>
        ) : conexoes.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center shadow-card">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Smartphone className="text-primary" size={22} />
            </div>
            <h2 className="mt-3 font-semibold text-foreground">Nenhum WhatsApp conectado</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Conecte o número da unidade para receber e responder as mensagens dos pacientes por aqui.
              Escolha a opção que mantém o número no celular se a equipe usa os grupos internos.
            </p>
            <div className="mt-5 flex flex-col items-center gap-2">
              <WhatsAppEmbeddedSignupButton onConnected={carregar} coexistence />
              <WhatsAppEmbeddedSignupButton onConnected={carregar} />
            </div>
          </div>
        ) : (
          <>
            <ul className="space-y-3">
              {conexoes.map((c) => {
                const st = rotuloStatus(c.status);
                return (
                  <li key={c.id} className="rounded-xl border border-border bg-card p-5 shadow-card">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">
                          {c.display_name || "WhatsApp da unidade"}
                        </p>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {c.phone_number_id ? `Número ${c.phone_number_id}` : "Número não identificado"}
                        </p>
                      </div>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                          st.ok
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {st.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                        {st.texto}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="rounded-xl border border-dashed border-border p-5">
              <p className="text-sm font-medium text-foreground">Conectar outro número</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Use quando esta unidade for atender por um número diferente.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <WhatsAppEmbeddedSignupButton onConnected={carregar} coexistence />
                <WhatsAppEmbeddedSignupButton onConnected={carregar} />
              </div>
            </div>
          </>
        )}

        {conectadas.length > 0 && (
          <p className="px-1 text-xs text-muted-foreground">
            As mensagens enviadas pelo celular também aparecem aqui quando o número está no modo que
            mantém o WhatsApp no aparelho.
          </p>
        )}
      </div>
    </div>
  );
}
