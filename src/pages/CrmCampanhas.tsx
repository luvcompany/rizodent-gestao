import { useState, useEffect, useCallback, useMemo } from "react";
import { deduplicateTemplates } from "@/lib/templateUtils";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Send, Users, Share2, Play } from "lucide-react";
import { format } from "date-fns";
import TemplateSearchSelect from "@/components/chat/TemplateSearchSelect";
import ShareRoleDialog, { OwnerRoleBadge, type OwnerRole } from "@/components/crm/ShareRoleDialog";
import { useAuth } from "@/contexts/AuthContext";
import { motivoDoServidor } from "@/lib/erroDeFuncao";
import { Switch } from "@/components/ui/switch";
import { SeloSaudeWhatsapp } from "@/components/whatsapp/WhatsappSaude";
import { acaoDaTransmissao, envioAtivo, statusDaTransmissao } from "@/lib/transmissao";
import { lerSituacaoDosNumeros, somenteModelosDeNumerosAtivos } from "@/lib/whatsappNumeros";

/**
 * Transmissão (envio de um modelo aprovado para vários leads).
 *
 * Desde a auditoria (P08): o SERVIDOR é a fonte do status. A tela não grava
 * mais 'sending'/'draft' — antes, um timeout do navegador devolvia a campanha
 * para rascunho com o envio ainda rodando, e o 2º clique mandava tudo de novo
 * (AUTO-7). O botão fica desabilitado no clique, o broadcast-engine responde
 * 202 na hora (ou 409 se já estiver enviando) e a lista se atualiza sozinha
 * enquanto há transmissão "Enviando". Total, Enviados e Falhas vêm dos
 * destinatários (AUTO-8); o nome do modelo fica guardado na transmissão, que
 * continua enviando se o modelo for apagado (AUTO-16).
 */

// Colunas novas (template_name, failed_count, atividade_em, ultimo_erro) ainda
// não estão em types.ts (regenerado no fechamento): tipo local.
type Transmissao = {
  id: string;
  name: string;
  status: string;
  total_leads: number | null;
  sent_count: number | null;
  failed_count?: number | null;
  created_at: string;
  atividade_em?: string | null;
  ultimo_erro?: string | null;
  template_name?: string | null;
  owner_role?: string | null;
  shared_roles?: string[] | null;
};

type ModeloAprovado = {
  id: string;
  name: string;
  body_text: string | null;
  language: string | null;
  waba_id: string | null;
  whatsapp_number_id: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Número por onde o disparo em massa vai sair (RPC numero_de_envio_do_disparo).
 * Os campos podem vir vazios: o número legado (whatsapp_config) não tem linha
 * em whatsapp_numbers, e enquanto a RPC não responde nada foi resolvido.
 */
type NumeroDoDisparo = {
  numero_id: string | null;
  nome: string | null;
  phone_e164: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  origem: string | null;
  saude: string | null;
  motivo: string | null;
};

/**
 * Telefone do número de envio para exibição. Diferente de formatPhoneDisplayBR
 * (que completa o 9 do celular): aqui o número aparece exatamente como está
 * gravado — o selo diz "conectado na Meta" e a pessoa confere a linha pelo
 * número, então mostrar um 9 a mais faria conferir um número que não existe.
 */
function telefoneParaExibir(e164: string | null | undefined): string {
  const bruto = String(e164 || "").replace(/\D/g, "");
  if (!bruto) return "";
  const semPais = bruto.startsWith("55") && bruto.length >= 12 ? bruto.slice(2) : bruto;
  if (semPais.length === 10) return `(${semPais.slice(0, 2)}) ${semPais.slice(2, 6)}-${semPais.slice(6)}`;
  if (semPais.length === 11) return `(${semPais.slice(0, 2)}) ${semPais.slice(2, 7)}-${semPais.slice(7)}`;
  return `+${bruto}`;
}

/** Enquanto houver transmissão "Enviando", a lista se atualiza a cada 5 s. */
const ATUALIZAR_A_CADA_MS = 5000;

/**
 * Erro do banco (PostgREST) em PT-BR para o toast — a mensagem crua vem em
 * inglês ("duplicate key value violates unique constraint …").
 */
function erroDoBanco(err: { code?: string; message?: string } | null | undefined, padrao: string): string {
  switch (err?.code) {
    case "23505":
      return "o mesmo lead apareceu duas vezes na lista";
    case "23503":
      return "o modelo escolhido não está disponível para este cliente";
    case "42501":
      return "você não tem permissão para isso";
    default:
      return err?.code ? `${padrao} (código ${err.code})` : padrao;
  }
}

export default function CrmCampanhas() {
  const { userRole } = useAuth();
  const canShare = userRole === "crc" || userRole === "gerente" || userRole === "superadmin";
  const [broadcasts, setBroadcasts] = useState<Transmissao[]>([]);
  const [templates, setTemplates] = useState<ModeloAprovado[]>([]);
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);
  const [stages, setStages] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", template_id: "", pipeline_id: "", stage_id: "" });
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [criando, setCriando] = useState(false);
  // Transmissões com clique em andamento (botão desabilitado até a resposta).
  const [disparando, setDisparando] = useState<Set<string>>(new Set());
  const [shareTarget, setShareTarget] = useState<Transmissao | null>(null);
  // Número por onde o disparo vai sair (resolvido pelo banco, no funil escolhido)
  // e o interruptor que devolve à lista os modelos dos outros números.
  const [numeroDoDisparo, setNumeroDoDisparo] = useState<NumeroDoDisparo | null>(null);
  const [mostrarOutrosNumeros, setMostrarOutrosNumeros] = useState(false);
  const [numeros, setNumeros] = useState<{ id: string; display_name: string | null; waba_id: string | null }[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase.from("crm_broadcasts").select("*").order("created_at", { ascending: false });
    setBroadcasts((data as unknown as Transmissao[]) || []);
  }, []);

  useEffect(() => {
    load();
    Promise.all([
      supabase
        .from("crm_whatsapp_templates")
        .select("id, name, body_text, language, waba_id, whatsapp_number_id, created_at, updated_at")
        .eq("status", "APPROVED")
        .order("created_at", { ascending: false }),
      lerSituacaoDosNumeros(),
    ]).then(([{ data }, situacao]) =>
      setTemplates(deduplicateTemplates(somenteModelosDeNumerosAtivos((data as ModeloAprovado[]) || [], situacao)))
    );
    supabase.from("crm_pipelines").select("id, name").then(({ data }) => setPipelines(data || []));
  }, [load]);

  useEffect(() => {
    if (form.pipeline_id) supabase.from("crm_stages").select("id, name").eq("pipeline_id", form.pipeline_id).order("position").then(({ data }) => setStages(data || []));
  }, [form.pipeline_id]);

  // ─── Por qual número este disparo vai sair ───
  // O servidor resolve o número na hora do envio (carimbo do lead → número
  // padrão de envio → canal do funil → número principal). A RPC abaixo refaz a
  // MESMA ordem para o funil escolhido só para a tela poder avisar antes e
  // listar os modelos que existem na conta desse número — um modelo aprovado em
  // outra conta é recusado pela Meta em TODAS as mensagens do disparo.
  useEffect(() => {
    if (!open) return;
    let vivo = true;
    void (async () => {
      const { data, error } = await supabase.rpc("numero_de_envio_do_disparo", {
        p_pipeline_id: (form.pipeline_id || null) as unknown as string,
      });
      if (!vivo) return;
      setNumeroDoDisparo(error ? null : ((data ?? []) as unknown as NumeroDoDisparo[])[0] ?? null);
    })();
    return () => {
      vivo = false;
    };
  }, [open, form.pipeline_id]);

  // Nomes dos números para etiquetar cada modelo da lista (como o Instagram
  // mostra por qual conta a mensagem saiu).
  useEffect(() => {
    supabase
      .from("whatsapp_numbers")
      .select("id, display_name, waba_id")
      .then(({ data }) =>
        setNumeros((data as { id: string; display_name: string | null; waba_id: string | null }[]) || []),
      );
  }, []);

  const wabaDoEnvio = numeroDoDisparo?.waba_id ?? null;

  const nomeDoNumeroDoModelo = (t: ModeloAprovado): string => {
    if (!t.whatsapp_number_id) return "Número principal";
    const peloId = numeros.find((n) => n.id === t.whatsapp_number_id);
    if (peloId?.display_name) return peloId.display_name;
    const peloWaba = numeros.find((n) => n.waba_id && n.waba_id === t.waba_id);
    return peloWaba?.display_name ?? "Outro número";
  };

  const templatesDoNumero = useMemo(
    () => (wabaDoEnvio ? templates.filter((t) => String(t.waba_id ?? "") === String(wabaDoEnvio)) : templates),
    [templates, wabaDoEnvio],
  );

  // O modelo já escolhido nunca some da lista: se ele é de outro número, continua
  // ali (com a etiqueta do número) e a tela avisa — nada é escondido de quem já
  // selecionou.
  const modelosNaTela = useMemo(() => {
    if (mostrarOutrosNumeros) return templates;
    const sel = templates.find((t) => t.id === form.template_id);
    if (sel && !templatesDoNumero.includes(sel)) return [sel, ...templatesDoNumero];
    return templatesDoNumero;
  }, [mostrarOutrosNumeros, templates, templatesDoNumero, form.template_id]);

  const modeloEscolhido = templates.find((t) => t.id === form.template_id) ?? null;
  const avisoNumeroDiferente =
    !!modeloEscolhido && !!wabaDoEnvio && String(modeloEscolhido.waba_id ?? "") !== String(wabaDoEnvio);

  // Atualização automática enquanto alguma transmissão está sendo enviada (um
  // 'sending' parado há 10 min não prende a tela; ele oferece Continuar envio).
  const temEnvioAtivo = broadcasts.some((b) => envioAtivo(b));
  useEffect(() => {
    if (!temEnvioAtivo) return;
    const t = setInterval(() => { void load(); }, ATUALIZAR_A_CADA_MS);
    return () => clearInterval(t);
  }, [temEnvioAtivo, load]);

  // A audiência nunca inclui leads bloqueados nem leads com automações pausadas;
  // o RLS já restringe ao número/funil visível para o usuário (cada número é um mundo).
  const audienceQuery = (select: string, opts?: { count: "exact"; head: true }) => {
    let q = supabase
      .from("crm_leads")
      .select(select, opts as never)
      .eq("is_blocked", false)
      .not("automation_paused", "is", true);
    if (form.pipeline_id) q = q.eq("pipeline_id", form.pipeline_id);
    if (form.stage_id) q = q.eq("stage_id", form.stage_id);
    return q;
  };

  const preview = async () => {
    const { count } = await audienceQuery("id", { count: "exact", head: true });
    setPreviewCount(count || 0);
  };

  const create = async () => {
    if (criando) return;
    if (!form.name.trim() || !form.template_id) {
      toast.error("Nome e modelo são obrigatórios");
      return;
    }
    setCriando(true);
    try {
      // Destinatários primeiro, paginando pela CHAVE (id > último lido): por
      // deslocamento, um lead que entrasse no funil durante a leitura empurrava
      // a página e repetia o último id — e o índice único (transmissão, lead)
      // derrubava o lote inteiro de 500. O Set tira qualquer repetição.
      const PAGE = 1000;
      const vistos = new Set<string>();
      const leads: { id: string }[] = [];
      let ultimoId: string | null = null;
      while (true) {
        let q = audienceQuery("id");
        if (ultimoId) q = q.gt("id", ultimoId);
        const { data, error } = await q.order("id").limit(PAGE);
        if (error) {
          toast.error(`Não foi possível ler os leads do filtro: ${erroDoBanco(error, "tente de novo")}.`);
          return;
        }
        const pagina = (data as unknown as { id: string }[] | null) ?? [];
        for (const l of pagina) {
          if (!vistos.has(l.id)) {
            vistos.add(l.id);
            leads.push({ id: l.id });
          }
        }
        if (pagina.length < PAGE) break;
        ultimoId = pagina[pagina.length - 1].id;
      }
      if (leads.length === 0) {
        toast.error("Nenhum lead no filtro escolhido.");
        return;
      }

      // Nome e idioma do modelo ficam guardados pelo banco (gatilho) a partir
      // do template_id; total_leads é recalculado a cada lote inserido.
      const { data: bc, error: bcError } = await supabase.from("crm_broadcasts").insert({
        name: form.name.trim(), template_id: form.template_id,
        filter_pipeline_id: form.pipeline_id || null, filter_stage_id: form.stage_id || null,
        total_leads: 0, status: "draft",
      }).select().single();
      if (bcError || !bc) {
        toast.error(`Não foi possível criar a transmissão: ${erroDoBanco(bcError, "tente de novo")}.`);
        return;
      }

      // Confere o que realmente entrou: Total = destinatários inseridos.
      let inserted = 0;
      let recipientsError: string | null = null;
      const CHUNK = 500;
      for (let i = 0; i < leads.length; i += CHUNK) {
        const recipients = leads.slice(i, i + CHUNK).map(l => ({ broadcast_id: bc.id, lead_id: l.id }));
        const { data: ins, error: insError } = await supabase.from("crm_broadcast_recipients").insert(recipients).select("lead_id");
        if (insError) { recipientsError = erroDoBanco(insError, "erro ao gravar os destinatários"); break; }
        inserted += ins?.length ?? 0;
      }
      if (inserted === 0) {
        // Transmissão vazia não serve para nada: sai da lista.
        await supabase.from("crm_broadcasts").delete().eq("id", bc.id);
        toast.error(`Não foi possível adicionar os destinatários${recipientsError ? `: ${recipientsError}` : ""}`);
        return;
      }

      setOpen(false); setForm({ name: "", template_id: "", pipeline_id: "", stage_id: "" }); setPreviewCount(null);
      if (recipientsError) {
        toast.error(`Transmissão criada, mas só ${inserted} de ${leads.length} destinatários entraram: ${recipientsError}`);
      } else if (inserted < leads.length) {
        toast.error(`Transmissão criada, mas só ${inserted} de ${leads.length} destinatários entraram`);
      } else {
        toast.success(`Transmissão criada com ${inserted} destinatários`);
      }
    } finally {
      setCriando(false);
      void load();
    }
  };

  const send = async (b: Transmissao, continuar: boolean) => {
    if (disparando.has(b.id)) return;
    setDisparando((s) => new Set(s).add(b.id));
    // Otimista: a linha já mostra "Enviando" (o servidor confirma na recarga).
    setBroadcasts((lista) => lista.map((x) => (x.id === b.id ? { ...x, status: "sending", atividade_em: new Date().toISOString() } : x)));
    try {
      const { data, error } = await supabase.functions.invoke("broadcast-engine", { body: { broadcast_id: b.id } });
      if (error) {
        const nome = (error as { name?: string }).name;
        if (nome === "FunctionsFetchError" || nome === "FunctionsRelayError") {
          // Sem resposta do servidor: NÃO volta para rascunho (o envio pode ter
          // começado). A lista mostra o estado real em instantes.
          toast.error("Não foi possível confirmar o início do envio. Confira o status em instantes antes de tentar de novo.");
        } else {
          toast.error(await motivoDoServidor(data, error, "Não foi possível iniciar o envio."));
        }
      } else {
        toast.success(continuar ? "Envio retomado. Acompanhe o andamento na lista." : "Envio iniciado. Acompanhe o andamento na lista.");
      }
    } finally {
      setDisparando((s) => {
        const n = new Set(s);
        n.delete(b.id);
        return n;
      });
      void load();
    }
  };

  return (
    <div className="animate-fade-in space-y-5 lg:space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
           <h1 className="text-[28px] font-bold leading-tight tracking-tight sm:text-[32px]">Transmissão</h1>
          <p className="text-muted-foreground">Envie modelos aprovados para vários leads de uma vez</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
           <DialogTrigger asChild><Button size="sm" className="h-10 rounded-xl shadow-brand"><Plus size={16} /> Nova transmissão</Button></DialogTrigger>
           <DialogContent className="rounded-2xl border-border/60 p-0 sm:max-w-lg">
             <div className="border-b border-border/60 p-5 pb-4 sm:p-6 sm:pb-4">
            <DialogHeader><DialogTitle>Nova transmissão</DialogTitle></DialogHeader>
             </div>
             <div className="space-y-4 p-5 sm:p-6">
                <div className="space-y-1.5"><Label>Nome</Label><Input className="h-10 rounded-xl" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
               {numeroDoDisparo && (
                 <div className="rounded-xl border border-border/60 bg-surface-sunken p-3">
                   <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                     <span className="text-muted-foreground">Vai sair por:</span>
                     <span className="font-semibold">{numeroDoDisparo.nome ?? "número não definido"}</span>
                      {numeroDoDisparo.phone_e164 && (
                        <span className="text-xs text-muted-foreground">
                          {telefoneParaExibir(numeroDoDisparo.phone_e164)}
                        </span>
                      )}
                     <span className="text-[11px] text-muted-foreground">
                       {numeroDoDisparo.origem === "funil"
                         ? "número do funil"
                         : numeroDoDisparo.origem === "principal"
                           ? "número principal"
                           : "número padrão de envio"}
                     </span>
                   </div>
                   <SeloSaudeWhatsapp phoneNumberId={numeroDoDisparo.phone_number_id} />
                 </div>
               )}
               <div className="space-y-1.5">
                 <Label>Modelo</Label>
                 <TemplateSearchSelect
                   templates={modelosNaTela}
                   value={form.template_id || undefined}
                   onValueChange={v => setForm(p => ({ ...p, template_id: v }))}
                   placeholder="Selecione o modelo"
                   labelExtra={t => nomeDoNumeroDoModelo(t as ModeloAprovado)}
                 />
                 {avisoNumeroDiferente && (
                   <p className="text-xs text-destructive">
                     Este modelo é do número {modeloEscolhido ? nomeDoNumeroDoModelo(modeloEscolhido) : "outro"} — o
                     disparo sai por {numeroDoDisparo?.nome ?? "outro número"}. Escolha um modelo do número que vai
                     enviar.
                   </p>
                 )}
                 <div className="flex items-center gap-2 pt-1">
                   <Switch id="mostrar-outros-numeros" checked={mostrarOutrosNumeros} onCheckedChange={setMostrarOutrosNumeros} />
                   <label htmlFor="mostrar-outros-numeros" className="cursor-pointer select-none text-xs text-muted-foreground">
                     Mostrar modelos de outros números
                   </label>
                 </div>
               </div>
               <div className="space-y-1.5"><Label>Funil (filtro)</Label><Select value={form.pipeline_id} onValueChange={v => setForm(p => ({ ...p, pipeline_id: v, stage_id: "" }))}><SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Todos" /></SelectTrigger><SelectContent>{pipelines.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
               {form.pipeline_id && <div className="space-y-1.5"><Label>Etapa (filtro)</Label><Select value={form.stage_id} onValueChange={v => setForm(p => ({ ...p, stage_id: v }))}><SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Todas" /></SelectTrigger><SelectContent>{stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>}
               <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-sunken p-3">
                 <Button variant="outline" className="h-10 rounded-xl" onClick={preview}><Users size={16} /> Prévia</Button>
                {previewCount !== null && <span className="text-sm text-muted-foreground">{previewCount} leads</span>}
              </div>
               <Button onClick={create} className="h-10 w-full rounded-xl" disabled={criando}>
                <Send size={16} /> {criando ? "Criando…" : "Criar transmissão"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="overflow-hidden rounded-card border border-border/60 bg-card shadow-card"><Table className="sm:min-w-[900px]">
        <TableHeader className="max-sm:hidden"><TableRow><TableHead>Nome</TableHead><TableHead>Status</TableHead><TableHead>Visibilidade</TableHead><TableHead>Total</TableHead><TableHead>Enviados</TableHead><TableHead>Falhas</TableHead><TableHead>Data</TableHead><TableHead>Ações</TableHead></TableRow></TableHeader>
        <TableBody className="max-sm:block">
          {broadcasts.map(b => {
            const st = statusDaTransmissao(b.status);
            const acao = acaoDaTransmissao(b);
            const ocupado = disparando.has(b.id);
            return (
               <TableRow key={b.id} className="max-sm:grid max-sm:grid-cols-2 max-sm:gap-2 max-sm:border-b max-sm:border-border/60 max-sm:p-4">
                 <TableCell className="font-medium max-sm:col-span-2 max-sm:block max-sm:p-0">
                  <div>{b.name}</div>
                  {b.template_name && <div className="text-xs text-muted-foreground">Modelo: {b.template_name}</div>}
                </TableCell>
                 <TableCell className="max-sm:block max-sm:p-0">
                  <Badge variant={st.variante} title={b.ultimo_erro || st.dica}>{st.rotulo}</Badge>
                  {b.ultimo_erro && (b.status === "paused" || b.status === "failed") && (
                    <div className="mt-1 max-w-[220px] text-xs text-muted-foreground">{b.ultimo_erro}</div>
                  )}
                </TableCell>
                 <TableCell className="max-sm:block max-sm:p-0"><OwnerRoleBadge ownerRole={(b.owner_role ?? null) as OwnerRole} /></TableCell>
                 <TableCell className="max-sm:block max-sm:p-0 max-sm:before:mr-1 max-sm:before:text-muted-foreground max-sm:before:content-['Total:']">{b.total_leads ?? 0}</TableCell>
                 <TableCell className="max-sm:block max-sm:p-0 max-sm:before:mr-1 max-sm:before:text-muted-foreground max-sm:before:content-['Enviados:']">{b.sent_count ?? 0}</TableCell>
                 <TableCell className="max-sm:block max-sm:p-0 max-sm:before:mr-1 max-sm:before:text-muted-foreground max-sm:before:content-['Falhas:']">
                  {/* A tela não lista os destinatários: o motivo mais comum das
                      falhas (ultimo_erro, gravado ao concluir) fica aqui. */}
                  {(b.failed_count ?? 0) > 0 && b.ultimo_erro && b.status === "completed" ? (
                    <span title={b.ultimo_erro} className="cursor-help underline decoration-dotted underline-offset-2">
                      {b.failed_count}
                    </span>
                  ) : (
                    b.failed_count ?? 0
                  )}
                </TableCell>
                 <TableCell className="text-sm text-muted-foreground max-sm:block max-sm:p-0">{format(new Date(b.created_at), "dd/MM/yyyy HH:mm")}</TableCell>
                 <TableCell className="max-sm:col-span-2 max-sm:block max-sm:p-0">
                   <div className="flex flex-wrap gap-1.5">
                    {acao === "enviar" && (
                       <Button size="sm" variant="outline" className="rounded-xl" disabled={ocupado} onClick={() => send(b, false)}>
                        <Send size={14} /> {ocupado ? "Enviando…" : "Enviar"}
                      </Button>
                    )}
                    {acao === "continuar" && (
                       <Button size="sm" variant="outline" className="rounded-xl" disabled={ocupado} onClick={() => send(b, true)}>
                        <Play size={14} /> {ocupado ? "Retomando…" : "Continuar envio"}
                      </Button>
                    )}
                     {canShare && <Button size="icon" variant="ghost" className="rounded-xl" title="Compartilhar com papel" onClick={() => setShareTarget(b)}><Share2 size={14} /></Button>}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
          {broadcasts.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nenhuma transmissão</TableCell></TableRow>}
        </TableBody>
      </Table></div>

      <ShareRoleDialog
        open={!!shareTarget}
        onOpenChange={(v) => !v && setShareTarget(null)}
        table="crm_broadcasts"
        rowId={shareTarget?.id ?? null}
        currentOwnerRole={(shareTarget?.owner_role ?? null) as OwnerRole}
        currentSharedRoles={(shareTarget?.shared_roles ?? []) as string[]}
        itemLabel="Transmissão"
        onSaved={load}
      />
    </div>
  );
}
