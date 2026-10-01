import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertCircle, CheckCircle2, Clock, GitBranch, Loader2, PlugZap, Power, Star, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { motivoDoServidor } from "@/lib/erroDeFuncao";
import whatsappLogo from "@/assets/whatsapp-logo.png";

/**
 * Números de WhatsApp do cliente — SÓ LEITURA + "Testar conexão".
 *
 * No v2 quem cadastra, desativa ou troca o número é o administrador do sistema
 * (ou o próprio cliente pelo Embedded Signup). Esta seção lista o que o usuário
 * logado enxerga (RPC whatsapp_numeros_visiveis: colunas públicas, sem token)
 * e testa o número pela function minha-conexao-whatsapp, que resolve o token no
 * servidor. Nenhuma chamada à Graph sai do navegador.
 */

export type NumeroVisivel = {
  id: string;
  display_name: string | null;
  phone_e164: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  is_active: boolean;
  is_default: boolean;
  is_coexistence: boolean | null;
  status: string | null;
  origem: string | null;
  verified_name: string | null;
  quality_rating: string | null;
  ultimo_webhook_em: string | null;
  ultimo_envio_em: string | null;
  ultimo_teste_em: string | null;
  ultimo_teste_ok: boolean | null;
  ultimo_erro: string | null;
  pipeline_id: string | null;
  pipeline_nome: string | null;
  app_origem: "geral" | "proprio" | null;
};

// { ok:true, display_phone_number, verified_name, quality_rating } | { ok:false, erro }
type RespostaTeste = {
  ok: boolean;
  display_phone_number?: string | null;
  verified_name?: string | null;
  quality_rating?: string | null;
  erro?: string;
};

type ResultadoTeste = { ok: boolean; texto: string; em: Date };

// types.ts ainda não conhece as RPCs novas (é regenerado no fechamento).
// bind: rpc usa `this` (o client); solta numa variável, perderia o contexto.
const rpcNumeros = supabase.rpc.bind(supabase) as unknown as (
  nome: "whatsapp_numeros_visiveis",
) => Promise<{ data: NumeroVisivel[] | null; error: { message: string } | null }>;

/** Nome que aparece no cartão e nos seletores. */
function nomeDoNumero(n: Pick<NumeroVisivel, "display_name" | "verified_name">): string {
  return n.display_name?.trim() || n.verified_name?.trim() || "WhatsApp";
}

type Situacao = { texto: string; tom: "ok" | "aviso" | "erro" | "neutro" };

function situacaoDoNumero(n: NumeroVisivel): Situacao {
  if (!n.is_active || n.status === "desativado") return { texto: "Desativado", tom: "neutro" };
  if (n.status === "erro") return { texto: "Com erro", tom: "erro" };
  if (n.status === "pendente") return { texto: "Pendente", tom: "aviso" };
  if (n.status === "conectado") return { texto: "Conectado", tom: "ok" };
  return { texto: "Pendente", tom: "aviso" };
}

const CLASSE_TOM: Record<Situacao["tom"], string> = {
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  aviso: "bg-warning/15 text-foreground dark:text-warning",
  erro: "bg-destructive/15 text-destructive",
  neutro: "bg-muted text-muted-foreground",
};

function IconeTom({ tom }: { tom: Situacao["tom"] }) {
  if (tom === "ok") return <CheckCircle2 size={12} />;
  if (tom === "erro") return <XCircle size={12} />;
  if (tom === "neutro") return <Power size={12} />;
  return <AlertCircle size={12} />;
}

function quando(iso: string | Date | null | undefined): string {
  if (!iso) return "nunca";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return formatDistanceToNow(d, { addSuffix: true, locale: ptBR });
}

const ROTULO_QUALIDADE: Record<string, string> = {
  GREEN: "alta",
  YELLOW: "média",
  RED: "baixa",
};

// Motivos que o callback do Embedded Signup devolve (via /oauth-close).
const MOTIVO_CONEXAO: Record<string, string> = {
  negado: "A autorização foi cancelada.",
  state: "O link de conexão expirou ou já foi usado. Tente de novo.",
  permissao: "Seu usuário não tem permissão para conectar este número.",
  config: "A conexão pelo Facebook não está configurada para este cliente.",
  outro_tenant: "Este número já está conectado em outro cliente.",
  banco: "Não foi possível salvar o número.",
  webhooks: "Conectado, mas o recebimento de mensagens não foi confirmado.",
  sessao: "Conclua a conexão neste navegador, logado com o mesmo usuário.",
};

function limparParametroWhatsapp() {
  const params = new URLSearchParams(window.location.search);
  params.delete("whatsapp");
  params.delete("count");
  params.delete("reason");
  const resto = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${resto ? `?${resto}` : ""}${window.location.hash}`);
}

interface Props {
  /** Título da seção; `null` esconde o cabeçalho inteiro. */
  titulo?: ReactNode | null;
  /** Botões/elementos no canto do cabeçalho (ex.: Embedded Signup). */
  acoes?: ReactNode;
  /** Conteúdo entre o cabeçalho e a lista (ex.: resumo e texto de ajuda). */
  topo?: ReactNode;
  /** Texto do estado vazio. */
  textoVazio?: string;
  /** Complemento do estado vazio (ex.: botão de conectar). */
  complementoVazio?: ReactNode;
  /** Mude o valor para forçar a releitura da lista (ex.: popup fechado). */
  versao?: number;
  /** Avisado a cada leitura da lista. */
  onCarregado?: (numeros: NumeroVisivel[]) => void;
}

export default function WhatsAppAccountsSection({
  titulo,
  acoes,
  topo,
  textoVazio = "Nenhum número conectado",
  complementoVazio,
  versao = 0,
  onCarregado,
}: Props) {
  const [numeros, setNumeros] = useState<NumeroVisivel[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  const [testando, setTestando] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Record<string, ResultadoTeste>>({});

  const avisar = useRef(onCarregado);
  useEffect(() => {
    avisar.current = onCarregado;
  }, [onCarregado]);

  const carregar = useCallback(async () => {
    const { data, error } = await rpcNumeros("whatsapp_numeros_visiveis");
    if (error) {
      setErroLeitura("Não foi possível carregar os números de WhatsApp.");
    } else {
      const lista = data ?? [];
      setErroLeitura(null);
      setNumeros(lista);
      avisar.current?.(lista);
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar, versao]);

  // Retorno do Embedded Signup: pela URL (?whatsapp=connected|error) ou pelo
  // postMessage do /oauth-close quando a conexão foi feita num popup.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const waStatus = params.get("whatsapp");
    if (waStatus === "connected") {
      const count = Number(params.get("count") ?? 0) || 0;
      toast.success(`WhatsApp conectado! ${count} número(s) vinculado(s).`);
      limparParametroWhatsapp();
      void carregar();
    } else if (waStatus === "error") {
      const motivo = MOTIVO_CONEXAO[params.get("reason") ?? ""];
      toast.error(motivo ?? "Falha ao conectar o WhatsApp. Tente novamente.");
      limparParametroWhatsapp();
    }

    const onMessage = (ev: MessageEvent) => {
      const d = ev.data as { type?: unknown; channel?: unknown; status?: unknown; count?: unknown; reason?: unknown } | null;
      if (!d || typeof d !== "object" || d.type !== "oauth_result") return;
      if (d.channel !== "whatsapp") return;
      if (d.status === "connected") {
        const count = typeof d.count === "number" ? d.count : 0;
        toast.success(`WhatsApp conectado! ${count} número(s) vinculado(s).`);
        if (d.reason === "webhooks") toast.warning(MOTIVO_CONEXAO.webhooks);
      } else {
        const motivo = typeof d.reason === "string" ? MOTIVO_CONEXAO[d.reason] : undefined;
        toast.error(motivo ?? "Falha ao conectar o WhatsApp. Tente novamente.");
      }
      void carregar();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [carregar]);

  const testar = async (n: NumeroVisivel) => {
    if (testando) return;
    setTestando(n.id);
    try {
      const { data, error } = await supabase.functions.invoke("minha-conexao-whatsapp", {
        body: { action: "testar", whatsapp_number_id: n.id },
      });
      if (error) {
        const texto = await motivoDoServidor(data, error, "Não foi possível testar a conexão.");
        setResultados((r) => ({ ...r, [n.id]: { ok: false, texto, em: new Date() } }));
        toast.error(texto);
        return;
      }
      const resp = (data ?? { ok: false }) as RespostaTeste;
      if (resp.ok) {
        const partes = [resp.verified_name, resp.display_phone_number].filter(Boolean).join(" · ");
        const qualidade = resp.quality_rating ? ROTULO_QUALIDADE[resp.quality_rating] : undefined;
        const texto = `Conexão OK${partes ? `: ${partes}` : ""}${qualidade ? ` (qualidade ${qualidade})` : ""}`;
        setResultados((r) => ({ ...r, [n.id]: { ok: true, texto, em: new Date() } }));
        toast.success(texto);
      } else {
        const texto = resp.erro || "A conexão falhou.";
        setResultados((r) => ({ ...r, [n.id]: { ok: false, texto, em: new Date() } }));
        toast.error(texto);
      }
      // O servidor grava ultimo_teste_* no número: relê para o cartão refletir.
      void carregar();
    } finally {
      setTestando(null);
    }
  };

  return (
    <div className="mb-6">
      {titulo !== null && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-semibold text-foreground">
            {titulo ?? (
              <>
                <img src={whatsappLogo} alt="" width={20} height={20} className="rounded-full" /> WhatsApp
              </>
            )}
          </h2>
          {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
        </div>
      )}

      {topo}

      {carregando ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" /> Carregando números…
          </CardContent>
        </Card>
      ) : erroLeitura ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <p className="text-sm text-destructive">{erroLeitura}</p>
            <Button size="sm" variant="outline" onClick={() => { setCarregando(true); void carregar(); }}>
              Tentar de novo
            </Button>
          </CardContent>
        </Card>
      ) : numeros.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <div className="rounded-full bg-muted p-4">
              <img src={whatsappLogo} alt="" width={36} height={36} className="rounded-full opacity-80" />
            </div>
            <h3 className="font-semibold text-foreground">{textoVazio}</h3>
            {complementoVazio}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {numeros.map((n) => {
            const sit = situacaoDoNumero(n);
            const resultado = resultados[n.id];
            const inativo = sit.tom === "neutro";
            return (
              <Card key={n.id}>
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className={`truncate text-sm font-semibold ${inativo ? "text-muted-foreground" : "text-foreground"}`}>
                        {nomeDoNumero(n)}
                      </h3>
                      <p className="truncate font-mono text-xs tabular-nums text-muted-foreground">
                        {n.phone_e164 || "Número não identificado"}
                      </p>
                    </div>
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${CLASSE_TOM[sit.tom]}`}>
                      <IconeTom tom={sit.tom} /> {sit.texto}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {n.is_default && (
                      <Badge variant="secondary" className="gap-1 text-[11px]">
                        <Star size={11} /> Padrão
                      </Badge>
                    )}
                    {n.is_coexistence && (
                      <Badge variant="secondary" className="text-[11px]">Também no celular</Badge>
                    )}
                    {n.quality_rating && ROTULO_QUALIDADE[n.quality_rating] && (
                      <Badge variant="outline" className="text-[11px]">
                        Qualidade {ROTULO_QUALIDADE[n.quality_rating]}
                      </Badge>
                    )}
                  </div>

                  <dl className="space-y-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <GitBranch size={12} className="shrink-0" />
                      <dt className="sr-only">Funil</dt>
                      <dd className="truncate">Funil: {n.pipeline_nome || "funil padrão do cliente"}</dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock size={12} className="shrink-0" />
                      <dt className="sr-only">Último webhook</dt>
                      <dd>Último evento da Meta: {quando(n.ultimo_webhook_em)}</dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <PlugZap size={12} className="shrink-0" />
                      <dt className="sr-only">Último teste</dt>
                      <dd>
                        Último teste:{" "}
                        {n.ultimo_teste_em
                          ? `${quando(n.ultimo_teste_em)} · ${n.ultimo_teste_ok ? "OK" : "falhou"}`
                          : "nunca"}
                      </dd>
                    </div>
                  </dl>

                  {(resultado || (n.ultimo_teste_ok === false && n.ultimo_erro) || (sit.tom === "erro" && n.ultimo_erro)) && (
                    <p
                      role="status"
                      className={`rounded-md px-2.5 py-1.5 text-xs ${
                        (resultado ? resultado.ok : false)
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      {resultado ? resultado.texto : n.ultimo_erro}
                    </p>
                  )}

                  <div className="mt-auto pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      disabled={testando !== null}
                      onClick={() => void testar(n)}
                    >
                      {testando === n.id ? (
                        <Loader2 size={14} className="mr-1 animate-spin" />
                      ) : (
                        <PlugZap size={14} className="mr-1" />
                      )}
                      {testando === n.id ? "Testando…" : "Testar conexão"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
