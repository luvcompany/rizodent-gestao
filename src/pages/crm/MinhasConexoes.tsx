import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Smartphone,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Minhas Conexões — conexão de WhatsApp INDIVIDUAL (closer e recepção).
 *
 * O token permanente NUNCA é gravado pelo navegador: ele viaja apenas para a
 * edge function `minha-conexao-whatsapp`, que valida contra a Graph API e grava
 * no servidor. A listagem também vem da function e nunca inclui token.
 *
 * Mesmo sistema visual da tela de Início da recepção: cartão claro com canto
 * 16px, ícone em quadrado pastel e status como pílula.
 */

const WEBHOOK_URL = "https://oybroifaleftwrhnlhqc.supabase.co/functions/v1/whatsapp-webhook";

type Item = {
  integration_id: string | null;
  number_id: string;
  display_name: string | null;
  phone_number_id: string | null;
  phone_e164: string | null;
  waba_id: string | null;
  status: string | null;
  pipeline_id: string | null;
  pipeline_name: string | null;
  criado_em: string | null;
  is_coexistence?: boolean;
};

type Pipeline = { id: string; name: string };

const rotuloStatus = (s: string | null) => {
  if (s === "connected") return { texto: "Conectado", ok: true };
  if (s === "disabled") return { texto: "Desativado", ok: false };
  return { texto: s || "Pendente", ok: false };
};

const formInicial = {
  display_name: "",
  phone_number_id: "",
  waba_id: "",
  app_id: "",
  token: "",
  webhook_verify_token: "",
  pipeline_id: "",
};

export default function MinhasConexoes() {
  const [itens, setItens] = useState<Item[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState(formInicial);
  const [verToken, setVerToken] = useState(false);
  const [conectando, setConectando] = useState(false);
  const [paraRemover, setParaRemover] = useState<Item | null>(null);
  const [salvandoCoex, setSalvandoCoex] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("minha-conexao-whatsapp", {
      body: { action: "list" },
    });
    if (error) {
      toast.error("Não foi possível carregar suas conexões");
    } else {
      setItens((data?.items ?? []) as Item[]);
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    carregar();
    supabase
      .from("crm_pipelines")
      .select("id, name")
      .order("created_at")
      .then(({ data }) => {
        const lista = (data ?? []) as Pipeline[];
        setPipelines(lista);
        // Com um único funil visível não há escolha a fazer: já vem selecionado.
        if (lista.length === 1) {
          setForm((f) => (f.pipeline_id ? f : { ...f, pipeline_id: lista[0].id }));
        }
      });
  }, [carregar]);

  const copiar = (texto: string) => {
    navigator.clipboard.writeText(texto);
    toast.success("Copiado");
  };

  const conectar = async () => {
    setConectando(true);
    const { data, error } = await supabase.functions.invoke("minha-conexao-whatsapp", {
      body: {
        action: "connect",
        display_name: form.display_name,
        token: form.token,
        phone_number_id: form.phone_number_id,
        waba_id: form.waba_id,
        app_id: form.app_id || undefined,
        webhook_verify_token: form.webhook_verify_token || undefined,
        pipeline_id: form.pipeline_id || undefined,
      },
    });

    // A function devolve a mensagem real da Meta no corpo; sem ler o contexto,
    // o erro chega ao usuário como "non-2xx status code".
    if (error) {
      let detalhe = error.message;
      const ctx = (error as unknown as { context?: Response }).context;
      if (ctx && typeof ctx.text === "function") {
        try {
          detalhe = JSON.parse(await ctx.text())?.error ?? detalhe;
        } catch { /* corpo não-JSON */ }
      }
      toast.error(detalhe);
      setConectando(false);
      return;
    }
    if (data?.error) {
      toast.error(data.error);
      setConectando(false);
      return;
    }

    toast.success("Número conectado");
    const chave = data?.integration_key as string | undefined;
    setForm(formInicial);
    setMostrarForm(false);
    await carregar();

    if (chave) {
      const { data: sync } = await supabase.functions.invoke("manage-whatsapp-templates", {
        body: { action: "list", integration_key: chave },
      });
      if (sync?.count != null) toast.success(`${sync.count} modelos sincronizados`);
    }
    setConectando(false);
  };

  /**
   * Marca a conexão como coexistência (o número também é usado no aplicativo do
   * celular). Muda a tela: a Cloud API não faz chamadas nesses números, então os
   * botões de ligar e de pedir permissão somem das conversas e fica a telefonia.
   */
  const alternarCoexistencia = async (item: Item, valor: boolean) => {
    setSalvandoCoex(item.number_id);
    const { data, error } = await supabase.functions.invoke("minha-conexao-whatsapp", {
      body: { action: "set_coexistence", number_id: item.number_id, is_coexistence: valor },
    });
    setSalvandoCoex(null);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || "Não foi possível salvar");
      return;
    }
    setItens((prev) => prev.map((c) => (c.number_id === item.number_id ? { ...c, is_coexistence: valor } : c)));
    toast.success(valor ? "Marcado como coexistência" : "Coexistência desmarcada");
  };

  const desconectar = async (item: Item) => {
    const { error } = await supabase.functions.invoke("minha-conexao-whatsapp", {
      body: { action: "disconnect", number_id: item.number_id },
    });
    if (error) toast.error("Não foi possível desconectar");
    else {
      toast.success("Número desconectado");
      carregar();
    }
    setParaRemover(null);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[780px] flex-col gap-5 pb-10">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Conexões</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            O WhatsApp por onde você fala com os pacientes. Cada pessoa conecta o próprio número.
          </p>
        </header>

        {carregando ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-20 text-muted-foreground shadow-sm">
            <Loader2 className="animate-spin" size={16} /> Verificando conexões...
          </div>
        ) : itens.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card px-6 py-12 text-center shadow-sm">
            <div className="mx-auto grid h-[52px] w-[52px] place-items-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
              <Smartphone size={24} />
            </div>
            <h2 className="mt-3.5 text-base font-bold tracking-tight text-foreground">
              Nenhum WhatsApp conectado
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
              Conecte o seu número para receber e responder as mensagens dos pacientes por aqui.
            </p>
            <div className="mt-6">
              <Button onClick={() => setMostrarForm(true)}>
                <Plus size={16} /> Conectar número
              </Button>
            </div>
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {itens.map((c) => {
                const st = rotuloStatus(c.status);
                return (
                  <li
                    key={c.number_id}
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
                        {c.display_name || "Meu WhatsApp"}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[12.5px] tabular-nums text-muted-foreground">
                        {c.phone_e164 || "Número não identificado"}
                      </span>
                      {c.pipeline_name && (
                        <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
                          Funil: {c.pipeline_name}
                        </span>
                      )}
                      <label className="mt-1.5 flex w-fit cursor-pointer items-center gap-2 text-[12.5px] text-muted-foreground">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 cursor-pointer accent-primary"
                          checked={c.is_coexistence === true}
                          disabled={salvandoCoex === c.number_id}
                          onChange={(e) => alternarCoexistencia(c, e.target.checked)}
                        />
                        Também uso este número no celular
                      </label>
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
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Desconectar número"
                      onClick={() => setParaRemover(c)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </li>
                );
              })}
            </ul>

            {!mostrarForm && (
              <div className="rounded-2xl border border-dashed border-border p-[18px]">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-muted text-muted-foreground">
                    <Plus size={17} />
                  </span>
                  <div>
                    <p className="text-[14.5px] font-semibold tracking-tight text-foreground">
                      Conectar outro número
                    </p>
                    <p className="text-[12.5px] text-muted-foreground">
                      Use quando você for atender por um número diferente.
                    </p>
                  </div>
                </div>
                <div className="mt-3.5">
                  <Button variant="outline" onClick={() => setMostrarForm(true)}>
                    <Plus size={16} /> Conectar número
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {mostrarForm && (
          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-[18px] shadow-sm">
            <div>
              <h2 className="text-base font-bold tracking-tight text-foreground">Conectar número</h2>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                Os dados vêm do Meta for Developers. O token é verificado e guardado no servidor.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Nome de exibição</Label>
                <Input
                  value={form.display_name}
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                  placeholder="Ex.: WhatsApp Ana"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phone Number ID</Label>
                <Input
                  value={form.phone_number_id}
                  onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })}
                  placeholder="123456789..."
                />
              </div>
              <div className="space-y-1.5">
                <Label>WABA ID</Label>
                <Input
                  value={form.waba_id}
                  onChange={(e) => setForm({ ...form, waba_id: e.target.value })}
                  placeholder="ID da conta do WhatsApp Business"
                />
              </div>
              <div className="space-y-1.5">
                <Label>App ID (Meta)</Label>
                <Input
                  value={form.app_id}
                  onChange={(e) => setForm({ ...form, app_id: e.target.value })}
                  placeholder="ID do aplicativo"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Token de acesso permanente</Label>
                <div className="flex gap-2">
                  <Input
                    type={verToken ? "text" : "password"}
                    value={form.token}
                    onChange={(e) => setForm({ ...form, token: e.target.value })}
                    placeholder="EAAG..."
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={verToken ? "Ocultar token" : "Mostrar token"}
                    onClick={() => setVerToken((v) => !v)}
                  >
                    {verToken ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Token de verificação do webhook (opcional)</Label>
                <Input
                  value={form.webhook_verify_token}
                  onChange={(e) => setForm({ ...form, webhook_verify_token: e.target.value })}
                  placeholder="Opcional"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="funil-conexao">Funil</Label>
                <select
                  id="funil-conexao"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.pipeline_id}
                  onChange={(e) => setForm({ ...form, pipeline_id: e.target.value })}
                >
                  <option value="">Sem funil</option>
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={conectar} disabled={conectando}>
                {conectando && <Loader2 className="animate-spin" size={16} />} Testar e conectar
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setMostrarForm(false);
                  setForm(formInicial);
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card p-[18px] shadow-sm">
          <p className="text-[14.5px] font-semibold tracking-tight text-foreground">
            URL do webhook
          </p>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Informe este endereço na configuração do webhook no Meta for Developers.
          </p>
          <div className="mt-2.5 flex gap-2">
            <Input readOnly value={WEBHOOK_URL} className="font-mono text-[12.5px]" />
            <Button variant="outline" size="icon" aria-label="Copiar URL do webhook" onClick={() => copiar(WEBHOOK_URL)}>
              <Copy size={16} />
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={!!paraRemover} onOpenChange={(o) => !o && setParaRemover(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar este número?</AlertDialogTitle>
            <AlertDialogDescription>
              As mensagens já recebidas continuam no histórico, mas o número para de enviar e
              receber por aqui até ser conectado de novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter conectado</AlertDialogCancel>
            <AlertDialogAction onClick={() => paraRemover && desconectar(paraRemover)}>
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
