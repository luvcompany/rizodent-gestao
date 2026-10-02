import { useState, useEffect, useRef } from "react";
import AdThumb from "@/components/chat/AdThumb";
import { ORIGENS_LEAD, ORIGENS_LEAD_INSTAGRAM, origemLeadCanonica, rotuloOrigemLead } from "@/lib/origensLead";
import { supabase } from "@/integrations/supabase/client";
import { getLeadChannel } from "@/lib/leadChannel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pencil, Trash2, X, Plus, Link2, Unlink, Video, Ban, MessageCircle, Send, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { SeloOperacao } from "@/components/operacao/SeloOperacao";
import { useTenant } from "@/contexts/TenantContext";
import { bloquearContatoNaMeta, papelBloqueiaNaMeta, temTelefoneParaMeta } from "@/lib/bloqueioMeta";
import { mensagemDeErro } from "@/lib/mensagemDeErro";
import { envioFalhou, motivoDoEnvio } from "@/lib/erroDoEnvio";
import { formatPhoneDisplayBR, lerTelefoneDigitado as lerTelefone, normalizePhoneParaGravar, phoneKey } from "@/lib/phoneUtils";
import { carregarModelosDoLead, type ModeloDoLead } from "@/hooks/useChatConversation";
import { useEnvioDoLead } from "@/hooks/useEnvioDoLead";
import EnviarModeloDialog, { type ComponentesDoModelo, type ModeloParaEnviar } from "@/components/chat/EnviarModeloDialog";
import { SeloDoEnvio } from "@/components/chat/AvisoDeEnvio";
import { mergeAdCandidates, type AdOption } from "@/lib/adCreativeOptions";

type Lead = {
  id: string;
  name: string;
  phone: string | null;
  source: string | null;
  tags: string[] | null;
  notes: string | null;
  value: number | null;
  ad_id?: string | null;
  imagem_origem?: string | null;
  nome_anuncio?: string | null;
  descricao_anuncio?: string | null;
  link_anuncio?: string | null;
  ad_account_id?: string | null;
  ad_account_name?: string | null;
  pipeline_id?: string | null;
  instagram_user_id?: string | null;
  active_channel?: string | null;
};

type Props = {
  lead: Lead;
  onLeadUpdated: (lead: Lead) => void;
  onLeadDeleted: () => void;
};


const SOURCE_OPTIONS_DEFAULT = ORIGENS_LEAD.map((o) => ({ value: o.valor, label: o.rotulo }));

const SOURCE_OPTIONS_INSTAGRAM = ORIGENS_LEAD_INSTAGRAM.map((o) => ({ value: o.valor, label: o.rotulo }));

/**
 * Telefone digitado → o que vai para o banco (CONV-16 / CRC-26). Uma regra só
 * com o Kanban e o webhook: 55 + DDD + número, mantendo o 9 do celular
 * (normalizePhoneParaGravar). Sem o 55 a Meta lia "77…" como código de país 7
 * e a próxima mensagem do paciente virava um segundo card. Aceita máscara,
 * "+55" e o zero de discagem; recusa o número brasileiro que não fecha 12–13
 * dígitos.
 *
 * Número estrangeiro só com o DDI explícito ("+351 …" ou "00351 …"): vai só
 * com os dígitos (o formato do wa_id da Meta, sem o 55) e com um aviso para
 * conferir o código do país. Sem o "+", 10–11 dígitos são sempre DDD + número
 * brasileiro — a mesma leitura do phone_key e do webhook.
 */
const MAXIMO_DIGITOS_E164 = 15;

/** Como o telefone gravado aparece na prévia: estrangeiro com "+" e os dígitos. */
function telefoneNaPrevia(tel: { gravar: string | null; aviso: string | null }): string {
  if (!tel.gravar) return "";
  return tel.aviso ? `+${tel.gravar}` : formatPhoneDisplayBR(tel.gravar);
}

/** Recusas da RPC transfer_lead_to_whatsapp em português. */
function motivoDaTransferencia(codigo: string | null | undefined, erro?: unknown): string {
  switch (codigo) {
    case "no_phone": return "Preencha o telefone antes de transferir.";
    case "lead_not_found": return "Lead não encontrado.";
    case "forbidden":
    case "forbidden_number_scope": return "Você não tem acesso ao número de WhatsApp deste lead.";
    case "duplicado_de_outra_dona": return "Já existe outro card com este telefone, de outra responsável. Peça à gestão para juntar os dois.";
    case "invalid_phone": return "Telefone inválido: confira o DDD e o número.";
    case "telefone_em_uso": return "Outro card deste número de WhatsApp já usa este telefone e não pôde ser juntado (ele pode estar bloqueado). Peça à gestão para conferir.";
    default: return erro ? mensagemDeErro(erro, "Não foi possível transferir.") : "Não foi possível transferir.";
  }
}

export default function LeadEditPanel({ lead, onLeadUpdated, onLeadDeleted }: Props) {
  const { user, userRole } = useAuth();
  const { tenant } = useTenant();
  // Decisão do dono (31/08, migração direitos_basicos_todo_papel): excluir
  // lead é direito básico de todo papel, cada um dentro do próprio mundo — o
  // banco continua limitando O QUE cada perfil alcança, não mais SE pode.
  const podeExcluir = true;
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState(lead.name);
  const [phone, setPhone] = useState(lead.phone || "");
  const [source, setSource] = useState(origemLeadCanonica(lead.source) || lead.source || "");
  const [customSource, setCustomSource] = useState("");
  const [value, setValue] = useState(lead.value?.toString() || "");
  const [tags, setTags] = useState<string[]>(lead.tags || []);
  const [newTag, setNewTag] = useState("");
  const [notes, setNotes] = useState(lead.notes || "");
  // Aviso de telefone repetido (phone_key): o 1º "Salvar" avisa; o 2º, com o
  // mesmo número, grava assim mesmo.
  const [duplicado, setDuplicado] = useState<{ telefone: string; nome: string } | null>(null);

  // Ad fields
  const [adId, setAdId] = useState(lead.ad_id || "");
  const [imagemOrigem, setImagemOrigem] = useState(lead.imagem_origem || "");
  const [nomeAnuncio, setNomeAnuncio] = useState(lead.nome_anuncio || "");
  const [descricaoAnuncio, setDescricaoAnuncio] = useState(lead.descricao_anuncio || "");
  const [linkAnuncio, setLinkAnuncio] = useState(lead.link_anuncio || "");
  const [adAccountId, setAdAccountId] = useState(lead.ad_account_id || "");
  const [adAccountName, setAdAccountName] = useState(lead.ad_account_name || "");

  // Ad selector
  const [ads, setAds] = useState<AdOption[]>([]);
  const [loadingAds, setLoadingAds] = useState(false);
  const [showAdSelector, setShowAdSelector] = useState(false);

  // Origem/Anúncio agora são preenchidos automaticamente (webhook + gatilho).
  // Mantemos edição manual apenas como exceção sob demanda.
  const [editSource, setEditSource] = useState(false);
  const [editAd, setEditAd] = useState(false);

  const isInstagramLead = getLeadChannel(lead) === "instagram";
  const SOURCE_OPTIONS = isInstagramLead ? SOURCE_OPTIONS_INSTAGRAM : SOURCE_OPTIONS_DEFAULT;
  const isKnownSource = SOURCE_OPTIONS.some((o) => o.value === source);
  // Vazio continua vazio: só valor desconhecido NÃO vazio cai em "outro".
  const effectiveSource = isKnownSource ? source : (source && SOURCE_OPTIONS.some((o) => o.value === "outro") ? "outro" : "");

  // ─── Transferência IG → WhatsApp (abre a conversa no WhatsApp via template) ───
  // CONV-8 / CONV-15: os modelos são os que o servidor aceita para ESTE lead
  // (RPC modelos_do_lead — só a WABA do número que vai enviar) e o envio passa
  // pela mesma confirmação do chat (EnviarModeloDialog: prévia preenchida e um
  // campo por variável, com a regra de valores do servidor). Antes a lista
  // juntava todas as WABAs e as variáveis iam fixas como [nome, clínica].
  const [transferOpen, setTransferOpen] = useState(false);
  const [loadingTransfer, setLoadingTransfer] = useState(false);
  const [transferTemplates, setTransferTemplates] = useState<ModeloDoLead[]>([]);
  const [erroModelos, setErroModelos] = useState<string | null>(null);
  const [modeloTransferencia, setModeloTransferencia] = useState<ModeloParaEnviar | null>(null);
  /** Telefone conferido e gravado ao escolher o modelo da transferência. */
  const telefoneDaTransferenciaRef = useRef<string | null>(null);
  // S29P-3d: WhatsApp pausado pelo suporte (ou sem conexão) aparece no
  // próprio popover, antes de escolher o modelo.
  const { bloqueio: bloqueioTransferencia } = useEnvioDoLead(lead.id, { ativo: transferOpen || !!modeloTransferencia });

  const loadTransferData = async () => {
    setLoadingTransfer(true);
    setErroModelos(null);
    try {
      const { modelos, erro } = await carregarModelosDoLead(lead.id, tenant.id);
      setTransferTemplates(modelos);
      setErroModelos(erro ? mensagemDeErro({ message: erro }, "Não foi possível carregar os modelos.") : null);
    } finally {
      setLoadingTransfer(false);
    }
  };

  /** Confere o telefone digitado (normalizado); a gravação fica com a RPC. */
  const conferirTelefoneDaTransferencia = (): string | null => {
    // Telefone já gravado com DDI estrangeiro (12–15 dígitos, sem o 55) e não
    // editado vai como está: sem o "+" ele não passaria pela regra brasileira.
    const naoEditado = phone.trim() === (lead.phone || "").trim();
    const digitosGravados = String(lead.phone ?? "").replace(/\D/g, "");
    const tel = naoEditado && digitosGravados.length >= 12 && digitosGravados.length <= MAXIMO_DIGITOS_E164 && !digitosGravados.startsWith("55")
      ? { gravar: digitosGravados, erro: null, aviso: null }
      : lerTelefone(phone);
    if (tel.erro) { toast.error(tel.erro); return null; }
    if (!tel.gravar) { toast.error("Preencha o telefone antes de transferir."); return null; }
    return tel.gravar;
  };

  const escolherModeloDaTransferencia = async (t: ModeloDoLead) => {
    if (bloqueioTransferencia) { toast.error(bloqueioTransferencia.texto); return; }
    const telefone = conferirTelefoneDaTransferencia();
    if (!telefone) return;
    telefoneDaTransferenciaRef.current = telefone;
    setTransferOpen(false);
    setModeloTransferencia(t);
  };

  const doTransfer = async (template: ModeloParaEnviar, componentes: ComponentesDoModelo) => {
    // O telefone conferido vai para a RPC, que junta o card duplicado e grava
    // o telefone na mesma transação.
    const telefone = telefoneDaTransferenciaRef.current || normalizePhoneParaGravar(lead.phone) || normalizePhoneParaGravar(phone);
    const { data: res, error: rpcErr } = await (supabase as any).rpc("transfer_lead_to_whatsapp", { p_lead_id: lead.id, p_phone: telefone });
    const r = res as { error?: string; merged?: boolean; phone?: string } | null;
    const codigo = r?.error ?? null;
    if (rpcErr || codigo) {
      toast.error(`Falha na transferência: ${motivoDaTransferencia(codigo, rpcErr)}`);
      return;
    }
    const telefoneFinal = r?.phone ?? telefone;
    const { data: sent, error: sendErr } = await supabase.functions.invoke("send-whatsapp-message", {
      body: {
        lead_id: lead.id,
        to: telefoneFinal,
        type: "template",
        template_name: template.name,
        template_language: template.language || "pt_BR",
        ...(componentes.length > 0 ? { template_components: componentes } : {}),
      },
    });
    if (envioFalhou(sent, sendErr)) {
      const motivo = await motivoDoEnvio(sent, sendErr, "Não foi possível enviar o modelo");
      if (motivo.semRegistro) toast.warning(motivo.texto);
      else toast.warning("Canal trocado para WhatsApp, mas o modelo não foi enviado: " + motivo.texto);
    } else {
      toast.success(r?.merged ? "Transferido para o WhatsApp (cards mesclados)!" : "Transferido para o WhatsApp!");
    }
    if (telefoneFinal) setPhone(telefoneFinal);
    onLeadUpdated({ ...lead, phone: telefoneFinal || lead.phone, active_channel: "whatsapp" } as Lead);
  };

  // Conteúdo do popover de transferência (aparece no painel e no editar).
  const conteudoTransferencia = (
    <>
      <div className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-foreground">
        Transferir para o WhatsApp
        {bloqueioTransferencia && <SeloDoEnvio bloqueio={bloqueioTransferencia} />}
      </div>
      <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground">
        Abre a conversa no WhatsApp com um modelo aprovado (a Meta exige modelo para iniciar). O card e o histórico continuam os mesmos.
      </p>
      {bloqueioTransferencia && (
        <p className="mb-3 rounded-xl bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-destructive-soft-foreground">{bloqueioTransferencia.texto}.</p>
      )}
      {loadingTransfer ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2"><Loader2 size={14} className="animate-spin" /> Carregando modelos…</div>
      ) : erroModelos ? (
        <p className="rounded-xl bg-destructive-soft px-3 py-2 text-xs leading-relaxed text-destructive-soft-foreground">{erroModelos}</p>
      ) : transferTemplates.length === 0 ? (
        <p className="rounded-xl bg-warning-soft px-3 py-2 text-xs leading-relaxed text-warning-soft-foreground">
          Nenhum modelo aprovado para o número deste lead. Crie e aprove um modelo de boas-vindas em <strong>Modelos</strong> para habilitar a transferência.
        </p>
      ) : (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-tertiary">Modelo de abertura</div>
          {transferTemplates.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={!!bloqueioTransferencia}
              onClick={() => void escolherModeloDaTransferencia(t)}
              className="w-full rounded-xl border border-border/60 bg-card px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-primary-soft-2 disabled:opacity-50"
            >
              <div className="font-medium truncate">{t.name}</div>
              {t.body_text && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t.body_text}</div>}
            </button>
          ))}
        </div>
      )}
    </>
  );

  useEffect(() => {
    if (editOpen) {
      setName(lead.name);
      setPhone(lead.phone || "");
      const s = origemLeadCanonica(lead.source) || lead.source || "";
      setSource(s);
      setCustomSource(SOURCE_OPTIONS.some((o) => o.value === s) ? "" : s);
      setValue(lead.value?.toString() || "");
      setTags(lead.tags || []);
      setNotes(lead.notes || "");
      setNewTag("");
      setDuplicado(null);
      setAdId(lead.ad_id || "");
      setImagemOrigem(lead.imagem_origem || "");
      setNomeAnuncio(lead.nome_anuncio || "");
      setDescricaoAnuncio(lead.descricao_anuncio || "");
      setLinkAnuncio(lead.link_anuncio || "");
      setAdAccountId(lead.ad_account_id || "");
      setAdAccountName(lead.ad_account_name || "");
      setShowAdSelector(false);
      setEditSource(false);
      setEditAd(false);
    }
  }, [editOpen, lead]);

  const loadAds = async () => {
    setLoadingAds(true);
    const candidates: Omit<AdOption, "group_key">[] = [];
    // Only look at recent rows — the RLS already isolates by tenant, but old rows bloat the dedupe set.
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // Run both queries in parallel (cuts wall time roughly in half)
    const [{ data: leadsData }, { data: msgData }, { data: mappingData }] = await Promise.all([
      supabase
        .from("crm_leads")
        .select("ad_id, imagem_origem, nome_anuncio, descricao_anuncio, link_anuncio, ad_account_id, ad_account_name")
        .not("ad_id", "is", null)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("messages")
        .select("ad_source_id, ad_image_url, ad_headline, ad_body, ad_source_url, ad_account_id, ad_account_name")
        .not("ad_source_id", "is", null)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("ad_id_mapping")
        .select("ad_id, thumbnail_url, ad_name, ad_headline, ad_body, ad_account_id, ad_account_name")
        .order("updated_at", { ascending: false })
        .limit(500),
    ]);

    if (leadsData) {
      for (const row of leadsData) {
        if (row.ad_id) {
          candidates.push({
            ad_id: row.ad_id!,
            imagem_origem: row.imagem_origem,
            nome_anuncio: row.nome_anuncio,
            descricao_anuncio: row.descricao_anuncio,
            link_anuncio: row.link_anuncio,
            ad_account_id: (row as any).ad_account_id || null,
            ad_account_name: (row as any).ad_account_name || null,
          });
        }
      }
    }

    if (msgData) {
      for (const row of msgData) {
        if (row.ad_source_id) {
          candidates.push({
            ad_id: row.ad_source_id!,
            imagem_origem: row.ad_image_url,
            nome_anuncio: row.ad_headline,
            descricao_anuncio: row.ad_body,
            link_anuncio: row.ad_source_url,
            ad_account_id: (row as any).ad_account_id || null,
            ad_account_name: (row as any).ad_account_name || null,
          });
        }
      }
    }

    if (mappingData) {
      for (const row of mappingData) {
        candidates.push({
          ad_id: row.ad_id,
          imagem_origem: row.thumbnail_url,
          nome_anuncio: row.ad_name || row.ad_headline,
          descricao_anuncio: row.ad_body,
          link_anuncio: null,
          ad_account_id: row.ad_account_id,
          ad_account_name: row.ad_account_name,
        });
      }
    }

    setAds(mergeAdCandidates(candidates));
    setLoadingAds(false);
  };

  const handleOpenAdSelector = () => {
    setShowAdSelector(true);
    loadAds();
  };

  const handleSelectAd = (ad: AdOption) => {
    setAdId(ad.ad_id);
    setImagemOrigem(ad.imagem_origem || "");
    setNomeAnuncio(ad.nome_anuncio || "");
    setDescricaoAnuncio(ad.descricao_anuncio || "");
    setLinkAnuncio(ad.link_anuncio || "");
    setAdAccountId(ad.ad_account_id || "");
    setAdAccountName(ad.ad_account_name || "");
    const src = ad.link_anuncio?.includes("instagram") ? "instagram_ad" : "facebook_ad";
    setSource(src);
    setShowAdSelector(false);
  };

  const handleUnlinkAd = () => {
    setAdId("");
    setImagemOrigem("");
    setNomeAnuncio("");
    setDescricaoAnuncio("");
    setLinkAnuncio("");
    setAdAccountId("");
    setAdAccountName("");
  };

  /** Outro lead (que quem edita enxerga) com a mesma chave de telefone (phone_key, P07). */
  const leadComMesmoTelefone = async (gravar: string): Promise<{ id: string; name: string } | null> => {
    const chave = phoneKey(gravar);
    if (!chave) return null;
    // Cast: phone_key é coluna nova (G2 — types.ts não é editado aqui).
    const { data, error } = await (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => { neq: (c: string, v: string) => { limit: (n: number) => Promise<{ data: unknown; error: unknown }> } };
        };
      };
    })
      .from("crm_leads")
      .select("id, name")
      .eq("phone_key", chave)
      .neq("id", lead.id)
      .limit(1);
    // Coluna ausente (banco sem a migration do P07) ou erro de rede: não trava a edição.
    if (error) return null;
    return ((data as { id: string; name: string }[] | null) ?? [])[0] ?? null;
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    // Telefone: só passa pela regra quando foi editado — um cadastro antigo em
    // outro formato não impede de salvar o nome ou as tags.
    const telefoneEditado = phone.trim() !== (lead.phone || "").trim();
    let telefoneFinal: string | null = lead.phone ?? null;
    if (telefoneEditado) {
      const tel = lerTelefone(phone);
      if (tel.erro) { toast.error(tel.erro); return; }
      telefoneFinal = tel.gravar;
      if (tel.gravar && tel.gravar !== (lead.phone || "") && duplicado?.telefone !== tel.gravar) {
        setSaving(true);
        const outro = await leadComMesmoTelefone(tel.gravar);
        setSaving(false);
        if (outro) {
          setDuplicado({ telefone: tel.gravar, nome: outro.name });
          toast.warning(`Já existe o lead "${outro.name}" com este telefone. Confira antes de salvar.`);
          return;
        }
      }
    }
    setSaving(true);
    // Sem origem e sem abrir "corrigir": grava inalterado (null), para não
    // desligar a atribuição automática do anúncio.
    const finalSource = !editSource && !lead.source
      ? null
      : effectiveSource === "outro" ? (customSource.trim() || "outro") : source;
    const updates = {
      // CONV-27: o nome vai como a pessoa digitou (sem forçar MAIÚSCULAS).
      name: name.trim().toLocaleUpperCase("pt-BR"),
      phone: telefoneFinal,
      source: finalSource || null,
      value: value ? parseFloat(value) : null,
      tags,
      notes: notes.trim() || null,
      ad_id: adId || null,
      imagem_origem: imagemOrigem || null,
      nome_anuncio: nomeAnuncio || null,
      descricao_anuncio: descricaoAnuncio || null,
      link_anuncio: linkAnuncio || null,
      ad_account_id: adAccountId || null,
      ad_account_name: adAccountName || null,
      updated_at: new Date().toISOString(),
    };
    // `.select()` para saber se a linha foi mesmo alterada: sem ele, uma edição
    // recusada pela regra do banco fechava o formulário com "Lead atualizado" e
    // o valor antigo voltava no próximo carregamento.
    const { data, error } = await supabase
      .from("crm_leads")
      .update(updates)
      .eq("id", lead.id)
      .select("id");
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar lead: " + mensagemDeErro(error));
      return;
    }
    if (!data || data.length === 0) {
      toast.error("Seu perfil não tem permissão para editar este lead.");
      return;
    }
    onLeadUpdated({ ...lead, ...updates } as Lead);
    setEditOpen(false);
    toast.success("Lead atualizado");
  };

  const handleDelete = async () => {
    // O `.select()` é o que torna a resposta verificável: quando a regra do
    // banco recusa a exclusão, não vem erro nenhum — vem sucesso com ZERO
    // linhas. Sem conferir o que voltou, a tela anunciava "excluído" e o lead
    // continuava lá, que foi exatamente o defeito relatado.
    const { data, error } = await supabase
      .from("crm_leads")
      .delete()
      .eq("id", lead.id)
      .select("id");
    if (error) {
      toast.error("Erro ao excluir lead: " + mensagemDeErro(error));
      return;
    }
    if (!data || data.length === 0) {
      toast.error("Seu perfil não tem permissão para excluir este lead.");
      return;
    }
    toast.success("Lead excluído");
    onLeadDeleted();
  };

  const addTag = () => {
    const tag = newTag.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
    }
    setNewTag("");
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="outline" className="h-9 gap-1.5 rounded-xl px-3 text-[13px] font-medium" onClick={() => setEditOpen(true)}>
          <Pencil size={15} strokeWidth={1.75} /> Editar
        </Button>
        <SeloOperacao leadId={lead.id} />
        {isInstagramLead && (
          lead.phone ? (
            <Popover open={transferOpen && !editOpen} onOpenChange={(o) => { setTransferOpen(o); if (o) { setPhone(lead.phone || ""); void loadTransferData(); } }}>
              <PopoverTrigger asChild>
                <Button type="button" size="sm" variant="outline" className="order-last h-auto min-h-9 w-full gap-1.5 whitespace-normal rounded-xl px-3.5 py-1.5 text-[13px] font-medium leading-tight" title="Transferir o atendimento para o WhatsApp">
                  <Send size={15} strokeWidth={1.75} /> Transferir p/ WhatsApp
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] rounded-2xl p-4">
                {conteudoTransferencia}
              </PopoverContent>
            </Popover>
          ) : (
            // Sem telefone: abre o editar já no campo de telefone (a transferência
            // exige número — a RPC recusa com 'no_phone').
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="order-last h-auto min-h-9 w-full gap-1.5 whitespace-normal rounded-xl px-3.5 py-1.5 text-[13px] font-medium leading-tight"
              title="Preencha o telefone para transferir"
              onClick={() => { setEditOpen(true); toast.info("Preencha o telefone para transferir para o WhatsApp."); }}
            >
              <Send size={15} strokeWidth={1.75} /> Transferir p/ WhatsApp
            </Button>
          )
        )}
        <Button size="sm" variant="outline" className="h-9 w-9 rounded-xl p-0 text-destructive hover:border-destructive/40 hover:bg-destructive-soft hover:text-destructive" title="Bloquear lead" onClick={() => setBlockOpen(true)}>
          <Ban size={16} strokeWidth={1.75} />
        </Button>
        {podeExcluir && (
          <Button size="sm" variant="outline" className="h-9 w-9 rounded-xl p-0 text-destructive hover:border-destructive/40 hover:bg-destructive-soft hover:text-destructive" title="Excluir lead" onClick={() => setDeleteOpen(true)}>
            <Trash2 size={16} strokeWidth={1.75} />
          </Button>
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold tracking-tight">Editar Lead</DialogTitle>
            <DialogDescription>Atualize as informações do lead.</DialogDescription>
          </DialogHeader>

          <div className="min-w-0 space-y-5">
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Nome *</label>
              <Input className="h-10 rounded-xl uppercase" value={name.toLocaleUpperCase("pt-BR")} onChange={(e) => setName(e.target.value.toLocaleUpperCase("pt-BR"))} />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Telefone</label>
              <div className="flex gap-2">
                <Input className="h-10 min-w-0 rounded-xl tabular-nums" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ex.: (77) 98123-4567" inputMode="tel" />
                {isInstagramLead && phone.trim() && (
                  <Popover open={transferOpen && editOpen} onOpenChange={(o) => { setTransferOpen(o); if (o) void loadTransferData(); }}>
                    <PopoverTrigger asChild>
                      <Button type="button" size="sm" variant="outline" className="h-10 shrink-0 gap-1.5 whitespace-nowrap rounded-xl px-3 text-[13px] font-medium" title="Transferir o atendimento para o WhatsApp">
                        <Send size={15} strokeWidth={1.75} /> Transferir p/ WhatsApp
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] rounded-2xl p-4">
                      {conteudoTransferencia}
                    </PopoverContent>
                  </Popover>
                )}
              </div>
              {(() => {
                // Como o telefone vai ser gravado (CONV-16) e se já existe outro
                // lead com ele (phone_key).
                if (phone.trim() === (lead.phone || "").trim()) return null;
                const tel = lerTelefone(phone);
                if (!phone.trim()) return null;
                if (tel.erro) return <p className="mt-1.5 text-xs font-medium text-destructive">{tel.erro}</p>;
                const repetido = duplicado && duplicado.telefone === tel.gravar ? duplicado : null;
                return (
                  <>
                    <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">Será gravado como {telefoneNaPrevia(tel)}.</p>
                    {tel.aviso && (
                      <p className="mt-1.5 rounded-xl bg-warning-soft px-3 py-2 text-xs leading-relaxed text-warning-soft-foreground">{tel.aviso}</p>
                    )}
                    {repetido && (
                      <p className="mt-1.5 rounded-xl bg-warning-soft px-3 py-2 text-xs leading-relaxed text-warning-soft-foreground">
                        Já existe o lead “{repetido.nome}” com este telefone. Salvar assim mesmo deixa dois cards para o mesmo paciente.
                      </p>
                    )}
                  </>
                );
              })()}
              {isInstagramLead && (
                <p className="mt-1.5 text-xs leading-relaxed text-tertiary">
                  As mensagens WhatsApp aparecem nesta mesma conversa e também na aba WhatsApp.
                </p>
              )}
            </div>
            {/* Origem: automática (webhook + gatilho). Edição manual só como exceção. */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[13px] font-medium text-muted-foreground">Origem</label>
                <button
                  type="button"
                  onClick={() => setEditSource((v) => !v)}
                  className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium text-info hover:bg-info-soft"
                  title="Corrigir manualmente (exceção)"
                >
                  <Pencil size={12} strokeWidth={1.75} /> {editSource ? "cancelar" : "corrigir"}
                </button>
              </div>
              {!editSource ? (
                <div className="flex min-h-10 items-center rounded-xl bg-surface-sunken px-3.5 text-sm text-foreground">
                  {source
                    ? (SOURCE_OPTIONS.find((o) => o.value === source)?.label || rotuloOrigemLead(source))
                    : <span className="text-muted-foreground italic">Automática (aguardando)</span>}
                </div>
              ) : (
                <>
                  <Select value={effectiveSource} onValueChange={(v) => { setSource(v); if (v !== "outro") setCustomSource(""); }}>
                    <SelectTrigger className="h-10 rounded-xl">
                      <SelectValue placeholder="Selecione a origem" />
                    </SelectTrigger>
                    <SelectContent>
                      {SOURCE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {effectiveSource === "outro" && (
                    <Input
                      className="mt-2 h-10 rounded-xl"
                      value={customSource}
                      onChange={(e) => setCustomSource(e.target.value)}
                      placeholder="Especifique a origem..."
                    />
                  )}
                </>
              )}
            </div>

            {/* Anúncio vinculado: automático via webhook. Edição manual só como exceção. */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[13px] font-medium text-muted-foreground">Anúncio</label>
                <button
                  type="button"
                  onClick={() => setEditAd((v) => !v)}
                  className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium text-info hover:bg-info-soft"
                  title="Corrigir manualmente (exceção)"
                >
                  <Pencil size={12} strokeWidth={1.75} /> {editAd ? "cancelar" : "corrigir"}
                </button>
              </div>

              {adId ? (
                <div className="space-y-2 rounded-xl border border-border/60 bg-surface-sunken p-3">
                  <div className="flex items-start gap-3">
                    {imagemOrigem ? (
                      <AdThumb src={imagemOrigem} alt="Anúncio" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-card">
                        <Video size={20} strokeWidth={1.75} className="text-tertiary" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{nomeAnuncio || "Anúncio vinculado"}</p>
                      {adAccountName && (
                        <p className="text-xs font-medium text-info">Conta: {adAccountName}</p>
                      )}
                      {descricaoAnuncio && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{descricaoAnuncio}</p>
                      )}
                    </div>
                    {editAd && (
                      <Button size="sm" variant="ghost" onClick={handleUnlinkAd} className="h-8 w-8 shrink-0 rounded-lg p-0 text-destructive hover:bg-destructive-soft hover:text-destructive" title="Desvincular">
                        <Unlink size={15} strokeWidth={1.75} />
                      </Button>
                    )}
                  </div>
                  {editAd && (
                    <Button size="sm" variant="outline" onClick={handleOpenAdSelector} className="h-9 w-full gap-1.5 rounded-xl text-[13px] font-medium">
                      <Link2 size={15} strokeWidth={1.75} /> Trocar anúncio
                    </Button>
                  )}
                </div>
              ) : editAd ? (
                <Button size="sm" variant="outline" onClick={handleOpenAdSelector} className="h-10 w-full gap-1.5 rounded-xl text-[13px] font-medium">
                  <Link2 size={15} strokeWidth={1.75} /> Selecionar anúncio
                </Button>
              ) : (
                <p className="flex min-h-10 items-center rounded-xl bg-surface-sunken px-3.5 text-sm italic text-muted-foreground">Automático (aguardando anúncio de origem)</p>
              )}

              {editAd && showAdSelector && (
                <div className="mt-2 max-h-60 overflow-y-auto rounded-xl border border-border/60 bg-card">
                  {loadingAds ? (
                    <p className="p-3 text-center text-xs text-muted-foreground">Carregando...</p>
                  ) : ads.length === 0 ? (
                    <p className="p-3 text-center text-xs text-muted-foreground">Nenhum anúncio encontrado</p>
                  ) : (
                    <div className="divide-y divide-border/60">
                      {ads.map((ad) => (
                        <button
                          key={ad.group_key}
                          type="button"
                          onClick={() => handleSelectAd(ad)}
                          className="flex w-full items-center gap-3 p-2.5 text-left transition-colors hover:bg-surface-sunken"
                        >
                          {ad.imagem_origem ? (
                            <AdThumb src={ad.imagem_origem} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                          ) : (
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-sunken">
                              <Video size={16} strokeWidth={1.75} className="text-tertiary" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{ad.nome_anuncio || "Sem nome"}</p>
                            {ad.ad_account_name && (
                              <p className="truncate text-xs font-medium text-info">Conta: {ad.ad_account_name}</p>
                            )}
                            {ad.descricao_anuncio && (
                              <p className="line-clamp-1 text-xs text-muted-foreground">{ad.descricao_anuncio}</p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Valor (R$)</label>
              <Input className="h-10 rounded-xl tabular-nums" type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Tags</label>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="h-7 gap-1 rounded-full border-transparent bg-muted px-3 text-xs font-medium text-foreground hover:bg-muted">
                    #{tag}
                    <button onClick={() => removeTag(tag)} className="-mr-1 grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-destructive-soft hover:text-destructive">
                      <X size={12} strokeWidth={1.75} />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  placeholder="Nova tag..."
                  className="h-10 rounded-xl text-sm"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                />
                <Button size="sm" variant="outline" onClick={addTag} type="button" className="h-10 w-10 shrink-0 rounded-xl p-0">
                  <Plus size={16} strokeWidth={1.75} />
                </Button>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Notas</label>
              <Textarea className="min-h-24 rounded-xl" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-10 rounded-xl px-4" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button className="h-10 rounded-xl px-5" onClick={handleSave} disabled={saving}>
              {saving
                ? "Salvando..."
                : duplicado && duplicado.telefone === lerTelefone(phone).gravar
                  ? "Salvar mesmo assim"
                  : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lead?</AlertDialogTitle>
            <AlertDialogDescription>
              O lead "{lead.name}" e o histórico de mensagens vão para a Lixeira e podem ser restaurados por 30 dias pela gestão da clínica (Configurações › Lixeira). Depois disso, são apagados de vez.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-10 rounded-xl px-4">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="h-10 rounded-xl bg-destructive px-5 text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={blockOpen} onOpenChange={setBlockOpen}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Bloquear este lead?</AlertDialogTitle>
            <AlertDialogDescription>
              As mensagens recebidas de "{lead.name}" serão descartadas e ele não aparecerá mais no Kanban nem na lista de conversas. Você pode desbloqueá-lo depois em Configurações → Bloqueados.
              {papelBloqueiaNaMeta(userRole) && temTelefoneParaMeta(lead.phone) && " Como você é da gestão, o número também será bloqueado na Meta: ele deixa de conseguir enviar mensagem para a clínica."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-10 rounded-xl px-4">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="h-10 rounded-xl bg-destructive px-5 text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                // Mesma armadilha da exclusão: update recusado pela regra do
                // banco volta sem erro e sem linha. Sem o `.select()`, a tela
                // dizia "bloqueado" e as mensagens continuavam chegando.
                const { data, error } = await supabase.from("crm_leads").update({
                  is_blocked: true,
                  blocked_at: new Date().toISOString(),
                  blocked_by: user?.id || null,
                } as any).eq("id", lead.id).select("id");
                if (error) { toast.error("Erro ao bloquear: " + mensagemDeErro(error)); return; }
                if (!data || data.length === 0) {
                  toast.error("Seu perfil não tem permissão para bloquear este lead.");
                  return;
                }
                toast.success("Lead bloqueado");
                // Bloqueio na Meta é só da gestão e nunca derruba o local. Lead só
                // do Instagram (sem telefone) não passa pela Meta do WhatsApp — o
                // aviso "Não consegui falar com a Meta" seria falso (INTEG-20).
                if (papelBloqueiaNaMeta(userRole) && temTelefoneParaMeta(lead.phone)) await bloquearContatoNaMeta(lead.id, "bloquear");
                onLeadDeleted();
              }}
            >
              Bloquear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação do modelo da transferência IG → WhatsApp (CONV-15). */}
      <EnviarModeloDialog
        open={!!modeloTransferencia}
        onOpenChange={(o) => { if (!o) setModeloTransferencia(null); }}
        leadId={lead.id}
        modelo={modeloTransferencia}
        onEnviar={doTransfer}
      />
    </>
  );
}
