import { useCallback, useEffect, useState } from "react";
import { Info, Smartphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import WhatsAppAccountsSection from "@/components/integrations/WhatsAppAccountsSection";
import WhatsAppEmbeddedSignupButton from "@/components/integrations/WhatsAppEmbeddedSignupButton";

/**
 * Minhas Conexões — o WhatsApp de quem atende (closer e recepção).
 *
 * No v2 ninguém cola token nesta tela. O número chega de dois jeitos:
 *  - a própria pessoa conecta o número do WhatsApp Business pelo Facebook
 *    (Embedded Signup em coexistência: o número continua no celular);
 *  - o administrador do sistema conecta pelo painel.
 *
 * A lista vem da RPC whatsapp_numeros_visiveis (só os números a que o usuário
 * tem acesso, sem token) e o botão "Testar conexão" chama a function
 * minha-conexao-whatsapp, que resolve o token no servidor.
 */

type ResumoWhatsApp = {
  embedded_signup_disponivel: boolean;
};

// types.ts ainda não conhece a RPC (é regenerado no fechamento).
const rpcResumo = supabase.rpc.bind(supabase) as unknown as (
  nome: "tenant_whatsapp_resumo",
) => Promise<{ data: ResumoWhatsApp | null; error: { message: string } | null }>;

const AVISO_SIGNUP_BLOQUEADO =
  "A conexão pelo Facebook ainda não está liberada. Peça ao administrador para conectar o número.";

export default function MinhasConexoes() {
  const [resumo, setResumo] = useState<ResumoWhatsApp | null>(null);
  const [versao, setVersao] = useState(0);
  // null até a lista chegar: o cartão "Conectar outro número" só aparece quando
  // já há número (sem número, o botão fica no próprio estado vazio).
  const [qtdNumeros, setQtdNumeros] = useState<number | null>(null);

  const carregarResumo = useCallback(async () => {
    const { data, error } = await rpcResumo("tenant_whatsapp_resumo");
    if (!error) setResumo(data ?? null);
  }, []);

  useEffect(() => {
    void carregarResumo();
  }, [carregarResumo]);

  const aposConectar = useCallback(() => {
    setVersao((v) => v + 1);
    void carregarResumo();
  }, [carregarResumo]);

  const liberado = resumo?.embedded_signup_disponivel === true;

  const conectar = (
    <div className="flex flex-col items-center gap-2">
      <WhatsAppEmbeddedSignupButton
        coexistencia
        rotulo="Conectar meu número do WhatsApp Business"
        onConnected={aposConectar}
        disabled={!liberado}
      />
      {resumo && !liberado && (
        <p className="flex max-w-md items-start gap-2 text-left text-[12.5px] text-muted-foreground">
          <Info size={14} className="mt-0.5 shrink-0" /> {AVISO_SIGNUP_BLOQUEADO}
        </p>
      )}
    </div>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[780px] flex-col gap-5 pb-10">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Conexões</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            O WhatsApp por onde você fala com os seus contatos. Aqui você acompanha o estado do número e pode testar a conexão.
          </p>
        </header>

        <WhatsAppAccountsSection
          titulo={
            <>
              <Smartphone size={18} /> Meus números
            </>
          }
          versao={versao}
          onCarregado={(lista) => setQtdNumeros(lista.length)}
          textoVazio="Você ainda não tem um número conectado."
          complementoVazio={
            <>
              <p className="max-w-md text-sm text-muted-foreground">
                Conecte o número do WhatsApp Business que você usa no celular. Ele continua funcionando no aparelho.
              </p>
              {conectar}
            </>
          }
        />

        {qtdNumeros !== null && qtdNumeros > 0 && (
        <div className="rounded-2xl border border-dashed border-border p-[18px]">
          <p className="text-[14.5px] font-semibold tracking-tight text-foreground">Conectar outro número</p>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Use o número do WhatsApp Business do seu celular. Se preferir, peça ao administrador do sistema para conectar.
          </p>
          <div className="mt-3.5 flex justify-start">{conectar}</div>
        </div>
        )}
      </div>
    </div>
  );
}
