import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Copy, Pencil, Eye, Image, FileText, Search, ChevronLeft, ChevronRight, RefreshCw, Users } from "lucide-react";
import { cleanTemplateName, indicesDasVariaveis } from "@/lib/templateUtils";
import { motivoDoServidor } from "@/lib/erroDeFuncao";
import { useServicosDoTenant } from "@/hooks/useOpcoesDoTenant";
import { useVocab } from "@/hooks/useVocab";
import { uploadAutomationMedia } from "@/components/automation/automationMediaUpload";
import { useAuth } from "@/contexts/AuthContext";
import type { Database, Json } from "@/integrations/supabase/types";
// Tipo local: no CRClin a lista de números vem de whatsapp_numbers direto
// (colunas públicas); os campos de diagnóstico do v2 ficam opcionais.
type NumeroVisivel = {
  id: string;
  display_name: string | null;
  phone_e164: string | null;
  phone_number_id?: string | null;
  waba_id?: string | null;
  is_active: boolean;
  is_default: boolean;
  is_coexistence?: boolean | null;
  status?: string | null;
  verified_name?: string | null;
};

import ShareRoleDialog, { type OwnerRole } from "@/components/crm/ShareRoleDialog";

/**
 * As edge functions devolvem o motivo no CORPO da resposta ("Número sem WABA
 * ou token…", "Sem acesso a este número…"); motivoDoServidor (erroDeFuncao.ts)
 * lê esse corpo — nada de "Edge Function returned a non-2xx status code". O
 * motivo técnico que o 409 traz à parte ("WABA sem token"…) fica fora da tela
 * (POS-18).
 */
type CorpoDeErro = { error?: unknown };

type PapelApp = Database["public"]["Enums"]["app_role"];

// types.ts ainda não conhece a RPC (é regenerado no fechamento).
// bind: rpc usa `this` (o client); solta numa variável, perderia o contexto.
// CRClin: sem a RPC whatsapp_numeros_visiveis — lê whatsapp_numbers direto (a
// RLS filtra o que cada papel vê), só colunas públicas.
const rpcNumeros = async (
  _nome: "whatsapp_numeros_visiveis",
): Promise<{ data: NumeroVisivel[] | null; error: { message: string } | null }> => {
  const { data, error } = await supabase
    .from("whatsapp_numbers")
    .select("id, display_name, phone_e164, is_active, is_default, waba_id")
    .order("display_name");
  return { data: (data as unknown as NumeroVisivel[] | null) ?? null, error: error ? { message: error.message } : null };
};

/** Rótulo do número no seletor: "nome · +55…". */
function rotuloDoNumero(n: NumeroVisivel): string {
  const nome = n.display_name?.trim() || n.verified_name?.trim() || "WhatsApp";
  return `${nome} · ${n.phone_e164 || "sem número"}`;
}


// Significado de cada {{N}} no envio (send-whatsapp-message). A amostra de
// {{3}} vem do cadastro do próprio cliente na tela (ver `variaveis`), com o
// neutro "Consulta" — nada de exemplo de um segmento só (AUTO-14/REC-08).
const TEMPLATE_VARIABLES: { index: number; label: string; sample: string; hint: string }[] = [
  { index: 1, label: "Nome do lead", sample: "Maria Silva", hint: "lead.name (fallback: cliente)" },
  // Formato do servidor desde 19/09/2026 (_shared/modeloEnviado.ts): com o dia
  // da semana; depois de "às" vai só a hora, depois de "hoje"/"amanhã", "às 14:00".
  { index: 2, label: "Data e hora do agendamento", sample: "Quarta, 20/05 às 14:00", hint: "próximo agendamento — depois de \"às\" vai só a hora; depois de \"hoje\"/\"amanhã\", \"às 14:00\" (fallback: data a confirmar)" },
  { index: 3, label: "Serviço de interesse", sample: "Consulta", hint: "lead.servico_interesse (fallback: consulta)" },
  { index: 4, label: "Telefone do lead", sample: "(11) 99999-9999", hint: "lead.phone" },
  { index: 5, label: "Origem do lead", sample: "Anúncio", hint: "lead.source" },
];

/** Amostra de {{2}} de acordo com a frase antes dela (mesma regra do envio). */
function amostraDaDataNoTexto(textoAntes: string, padrao: string): string {
  const antes = textoAntes.replace(/\s+$/u, "").toLowerCase();
  if (/(^|\s)às$/u.test(antes)) return "14:00";
  if (/(^|\s)(hoje|amanhã|amanha)$/u.test(antes)) return "às 14:00";
  return padrao;
}

/** Nome livre para a cópia: "x_copia", "x_copia2"… ou "x_v2", "x_v3"… */
function nomeLivre(base: string, sufixo: "copia" | "v", usados: Set<string>): string {
  if (sufixo === "v") {
    const m = /^(.*)_v(\d+)$/.exec(base);
    const raiz = m ? m[1] : base;
    let n = m ? Number(m[2]) + 1 : 2;
    while (usados.has(`${raiz}_v${n}`)) n++;
    return `${raiz}_v${n}`;
  }
  let nome = `${base}_copia`;
  for (let n = 2; usados.has(nome); n++) nome = `${base}_copia${n}`;
  return nome;
}

/**
 * Botão de modelo. Além de link e resposta rápida, existe o de FORMULÁRIO
 * (Flow): ele carrega o id do formulário e a tela onde abre. Esses dois campos
 * andavam junto com o botão sem ninguém saber — e sumiam na primeira edição
 * feita por aqui, deixando o modelo sem abrir nada.
 */
type BotaoModelo = {
  type: string;
  text: string;
  url?: string;
  flow_id?: string | number;
  flow_action?: string;
  navigate_screen?: string;
};

/** Formulário publicado na Meta, com as telas que ele tem. */
type FormularioDaMeta = { id: string; name: string; status: string; telas: { id: string; title: string }[] };


type WhatsAppTemplate = {
  id: string; name: string; category: string; language: string; status: string;
  header_type: string | null; header_content: string | null; body_text: string | null;
  footer_text: string | null; buttons: unknown; meta_template_id: string | null;
  created_at: string; updated_at: string;
  owner_role?: OwnerRole;
  shared_roles?: string[] | null;
  // Quem criou o modelo — é o que amarra editar/excluir da SDR ao item dela.
  created_by_user_id?: string | null;
  // Cada número tem a sua cópia dos modelos da WABA; rascunho pode vir sem número.
  whatsapp_number_id?: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  gerente: "Gerente", crc: "CRC", posvenda: "Pós-venda", recepcao: "Recepção", closer: "Closer", sdr: "SDR", superadmin: "Superadmin",
};
const ROLE_BADGE_COLOR: Record<string, string> = {
  gerente: "bg-blue-900/30 text-blue-400",
  crc: "bg-purple-900/30 text-purple-400",
  posvenda: "bg-green-900/30 text-green-400",
  recepcao: "bg-warning/15 text-warning",
  closer: "bg-warning/15 text-warning",
  sdr: "bg-teal-900/30 text-teal-400",
  superadmin: "bg-red-900/30 text-red-400",
};

const PAGE_SIZE = 10;

// Cabeçalho de MÍDIA do template (vídeo/imagem/documento). O Meta não aceita URL:
// exige um `header_handle` gerado por upload. Aqui subimos o arquivo e pedimos o
// handle ao backend — é isso que permite ter VÍDEO em template (que entrega mesmo
// fora da janela de 24h, ao contrário de mensagem livre).
function TemplateMediaHeader({
  headerType, headerContent, onChange, numeroId,
}: { headerType: string; headerContent: string; onChange: (handle: string) => void; numeroId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");

  // Áudio não existe em cabeçalho de modelo na Meta (AUTO-15).
  const accept = headerType === "VIDEO" ? "video/mp4,video/3gpp"
    : headerType === "IMAGE" ? "image/jpeg,image/png"
    : ".pdf,.doc,.docx,.xls,.xlsx";

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const up = await uploadAutomationMedia(file, "template-headers", { fileName: file.name });
      if (!up) return;
      const body: Record<string, unknown> = { action: "upload_media", media_url: up.url, file_name: up.name, file_type: up.mime };
      if (numeroId) body.whatsapp_number_id = numeroId;
      const { data, error } = await supabase.functions.invoke("manage-whatsapp-templates", { body });
      if (error || (data as CorpoDeErro | null)?.error) {
        throw new Error(await motivoDoServidor(data, error, "Falha ao enviar a mídia à Meta."));
      }
      const handle = (data as { handle?: string } | null)?.handle;
      if (!handle) throw new Error("A Meta não devolveu o identificador da mídia.");
      // Guardamos a URL do arquivo (não o handle): o ENVIO precisa de URL e a
      // criação do template gera o handle a partir dela no backend.
      onChange(up.url);
      setFileName(up.name);
      toast.success("Mídia enviada à Meta. Agora é só salvar o modelo.");
    } catch (err: unknown) {
      toast.error(err instanceof Error && err.message ? err.message : "Falha ao enviar a mídia à Meta.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={pick} />
      {headerContent ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5">
          <span className="text-xs truncate flex-1">{fileName || "Mídia enviada à Meta"}</span>
          <button type="button" className="text-xs text-primary hover:underline"
            onClick={() => inputRef.current?.click()} disabled={busy}>Trocar</button>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" className="h-8 w-full text-xs"
          onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? "Enviando à Meta…" : `Selecionar ${headerType === "VIDEO" ? "vídeo" : headerType === "IMAGE" ? "imagem" : "arquivo"}`}
        </Button>
      )}
      <p className="text-[10px] text-muted-foreground">
        Vídeo ≤16MB (MP4). O arquivo é enviado à Meta para aprovação junto com o modelo.
      </p>
    </div>
  );
}

export default function CrmModelos() {
  const { userRole, user } = useAuth();
  const canShare = userRole === "crc" || userRole === "posvenda" || userRole === "gerente" || userRole === "superadmin" || userRole === "closer";
  // A SDR vive no mundo do crc: vê o acervo dele inteiro, mas só EDITA e APAGA
  // o que ela criou (RESTRICTIVE sdr_escopo_crm_whatsapp_templates_update /
  // _delete). Sem isto, os botões apareciam em todo modelo do CRC e só
  // devolviam erro — no Excluir, ainda depois de chamar a Meta ("Erro ao
  // deletar na Meta. Removendo apenas localmente." antes de "Seu perfil não tem
  // permissão"). Molde de `podeEditarItem` em CrmRespostasRapidas.
  // Duplicar continua liberado de propósito: a cópia é um item NOVO criado por
  // ela (owner_role 'crc' + created_by_user_id = ela), que a policy de INSERT
  // aceita — é como ela parte de um modelo do acervo para fazer o dela.
  const podeEditarItem = (t: { created_by_user_id?: string | null }) =>
    userRole !== "sdr" || (!!user?.id && t.created_by_user_id === user.id);
  // owner_role de item novo: o do usuário, EXCETO sdr e gerente (o dono) — o
  // item deles nasce no mundo crc, o mesmo mapeamento que o gatilho
  // set_owner_role_from_user e a function manage-whatsapp-templates fazem.
  // Mandar 'sdr' explicitamente impedia o gatilho de agir e a policy de INSERT
  // recusava a gravação; 'gerente' esconderia o modelo do dono de CRC e SDR.
  const ownerRoleParaGravar = (papel: string | null) => (papel === "sdr" || papel === "gerente" ? "crc" : papel);

  // Amostra de {{3}}: 1º serviço do cadastro do cliente, senão o vocabulário do
  // segmento, senão o neutro "Consulta" (AUTO-14 / REC-08 / CRC-16).
  const servicosDoCliente = useServicosDoTenant();
  const vocab = useVocab();
  const servicoExemplo = useMemo(
    () => servicosDoCliente[0] || vocab.servicosInteresse.find((s) => s && s.toUpperCase() !== "OUTROS") || "Consulta",
    [servicosDoCliente, vocab.servicosInteresse],
  );
  const variaveis = useMemo(
    () => TEMPLATE_VARIABLES.map((v) => (v.index === 3 ? { ...v, sample: servicoExemplo } : v)),
    [servicoExemplo],
  );

  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("todos");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Números de WhatsApp que o usuário enxerga (RPC, sem token). Toda chamada à
  // function vai com o id do número escolhido (whatsapp_number_id).
  const [numeros, setNumeros] = useState<NumeroVisivel[]>([]);
  const [numerosCarregados, setNumerosCarregados] = useState(false);
  const [selectedNumero, setSelectedNumero] = useState<string>("");
  // Número escolhido DENTRO do editor (Novo Modelo / Editar rascunho): é ele
  // que recebe o rascunho e para quem a Meta cria o modelo — não o filtro do topo.
  const [formNumeroId, setFormNumeroId] = useState<string>("");
  // Formulários (Flows) publicados na conexão escolhida — carregados só quando
  // o editor abre, porque a Meta cobra uma chamada por formulário.
  const [formularios, setFormularios] = useState<FormularioDaMeta[]>([]);
  const [carregandoFormularios, setCarregandoFormularios] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [shareTarget, setShareTarget] = useState<WhatsAppTemplate | null>(null);

  const formVazio = {
    id: "", name: "", category: "UTILITY", language: "pt_BR", header_type: "" as string,
    header_content: "", body_text: "", footer_text: "",
    buttons: [] as BotaoModelo[],
    hasHeader: false,
    // Modelo que já existe na Meta (AUTO-13): só leitura.
    meta_template_id: null as string | null,
    status: "",
    // Amostra digitada por variável ({{N}} → texto) para a Meta aprovar.
    amostras: {} as Record<number, string>,
  };
  const [form, setForm] = useState(formVazio);
  // Modelo que já está na Meta não muda aqui: a Meta não deixa editar nome,
  // idioma e categoria, e a edição local só enganava (o paciente recebe o
  // aprovado, o sync desfazia em 5 min e o chat mostrava outro texto).
  const somenteLeitura = !!form.meta_template_id;

  // Números visíveis: padrão selecionado (is_default), senão o primeiro. Só os
  // ativos — número desativado não sincroniza nem cria modelo.
  useEffect(() => {
    let vivo = true;
    void rpcNumeros("whatsapp_numeros_visiveis").then(({ data, error }) => {
      if (!vivo) return;
      if (error) toast.error("Não foi possível carregar os números de WhatsApp.");
      const lista = (data ?? []).filter((n) => n.is_active);
      setNumeros(lista);
      const padrao = lista.find((n) => n.is_default) ?? lista[0];
      setSelectedNumero((atual) => (atual && lista.some((n) => n.id === atual) ? atual : padrao?.id ?? ""));
      setNumerosCarregados(true);
    });
    return () => { vivo = false; };
  }, []);

  const semNumero = numerosCarregados && numeros.length === 0;

  // Com mais de um número, cada um tem a sua cópia dos modelos: a lista mostra
  // a do número escolhido mais os rascunhos sem número. Com um só (ou nenhum),
  // mostra tudo o que o perfil enxerga (inclusive modelos compartilhados).
  const filtrarPorNumero = numeros.length > 1 && !!selectedNumero ? selectedNumero : null;

  const lerModelos = useCallback(async () => {
    let q = supabase
      .from("crm_whatsapp_templates")
      .select("*")
      .order("created_at", { ascending: false });
    if (filtrarPorNumero) q = q.or(`whatsapp_number_id.eq.${filtrarPorNumero},whatsapp_number_id.is.null`);
    return q;
  }, [filtrarPorNumero]);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    // Só do banco local — a leitura na Meta é o botão "Sincronizar".
    const [{ data, error }, inativos] = await Promise.all([lerModelos(), listarIdsNumerosInativos()]);
    if (!error) setTemplates(somenteModelosDeNumerosAtivos((data as WhatsAppTemplate[]) || [], inativos));
    setLoading(false);
  }, [lerModelos]);

  useEffect(() => {
    if (!numerosCarregados) return;
    void fetchTemplates();
  }, [fetchTemplates, numerosCarregados]);

  const handleSync = useCallback(async (silent = false) => {
    if (syncing) return;
    // Sem número conectado não há o que sincronizar (o botão já fica desabilitado).
    if (!selectedNumero) {
      if (!silent) toast.error("Nenhum número de WhatsApp conectado.");
      return;
    }
    setSyncing(true);
    try {
      const body: Record<string, unknown> = { action: "list", whatsapp_number_id: selectedNumero };
      const { data, error } = await supabase.functions.invoke("manage-whatsapp-templates", { body });
      if (error || (data as CorpoDeErro | null)?.error) {
        throw new Error(await motivoDoServidor(data, error, "Não foi possível sincronizar com a Meta."));
      }
      const { data: refreshed } = await lerModelos();
      if (refreshed) setTemplates(refreshed as WhatsAppTemplate[]);
      setLastSyncAt(new Date());
      const count = (data as { count?: number } | null)?.count ?? 0;
      const falhas = (data as { falhas_remocao?: number } | null)?.falhas_remocao ?? 0;
      if (!silent) toast.success(`Sincronizado! ${count} modelos encontrados na Meta.`);
      if (!silent && falhas > 0) {
        toast.warning(`${falhas} modelo(s) apagado(s) na Meta não saíram daqui. Tente sincronizar de novo.`);
      }
    } catch (e: unknown) {
      if (!silent) toast.error(`Erro ao sincronizar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  }, [selectedNumero, syncing, lerModelos]);

  // Não deduplicar nesta tela de gestão: o usuário precisa enxergar TODOS os
  // modelos (mesmo com mesmo nome base) para conseguir compartilhar individualmente.
  const filtered = templates.filter(t => {
    if (tab === "aprovados" && t.status !== "APPROVED") return false;
    if (tab === "pendentes" && t.status !== "PENDING" && t.status !== "REJECTED") return false;
    const clean = cleanTemplateName(t.name).toLowerCase();
    const rawName = (t.name || "").toLowerCase();
    if (
      search &&
      !clean.includes(search.toLowerCase()) &&
      !rawName.includes(search.toLowerCase()) &&
      !(t.body_text || "").toLowerCase().includes(search.toLowerCase())
    ) return false;
    if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const resetForm = () => setForm(formVazio);

  const openEdit = (t: WhatsAppTemplate) => {
    setFormNumeroId(t.whatsapp_number_id ?? selectedNumero ?? "");
    setForm({
      id: t.id, name: t.name, category: t.category, language: t.language,
      header_type: t.header_type || "", header_content: t.header_content || "",
      body_text: t.body_text || "", footer_text: t.footer_text || "",
      buttons: (t.buttons as BotaoModelo[]) || [],
      hasHeader: !!t.header_type,
      meta_template_id: t.meta_template_id ?? null,
      status: t.status,
      amostras: {},
    });
    setModalOpen(true);
  };

  /**
   * Cópia do modelo como RASCUNHO (AUTO-12: antes nascia "Pendente — em
   * análise pela Meta" para sempre, sem nunca ter ido à Meta). Fica no mesmo
   * número do original. `comoNovaVersao` (AUTO-13): nome "_v2", "_v3"… e o
   * editor abre na cópia para ajustar e enviar para aprovação.
   */
  const handleDuplicate = async (t: WhatsAppTemplate, comoNovaVersao = false) => {
    const { data: { user: atual } } = await supabase.auth.getUser();
    let ownerRole: string | null = null;
    if (atual) {
      const { data: roleRow } = await supabase.rpc("get_user_primary_role", { _user_id: atual.id });
      ownerRole = (roleRow as string) || null;
    }
    const numeroDaCopia = t.whatsapp_number_id ?? (selectedNumero || null);
    const usados = new Set(
      templates
        .filter((x) => (x.whatsapp_number_id ?? null) === numeroDaCopia && x.language === t.language)
        .map((x) => x.name),
    );
    // `usados` só tem os modelos que ESTA pessoa enxerga (RLS): o nome pode
    // estar ocupado por um modelo de outro papel. No 23505, tenta o próximo
    // nome livre em vez de pedir para renomear uma cópia que nem foi criada.
    let nome = "";
    let nova: WhatsAppTemplate | null = null;
    let error: { code?: string; message?: string } | null = null;
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      nome = nomeLivre(t.name, comoNovaVersao ? "v" : "copia", usados);
      const r = await supabase.from("crm_whatsapp_templates").insert([{
        name: nome, category: t.category, language: t.language,
        header_type: t.header_type, header_content: t.header_content,
        body_text: t.body_text, footer_text: t.footer_text, buttons: (t.buttons ?? null) as Json,
        status: "DRAFT",
        created_by_user_id: atual?.id || null,
        owner_role: ownerRoleParaGravar(ownerRole) as PapelApp | null,
        // A cópia fica no mesmo número do original.
        whatsapp_number_id: numeroDaCopia,
      }]).select("*").single();
      nova = (r.data as WhatsAppTemplate | null) ?? null;
      error = r.error;
      if (error?.code !== "23505") break;
      usados.add(nome);
    }
    if (error || !nova) {
      toast.error(
        error?.code === "23505"
          ? `Não achamos um nome livre para a cópia de "${t.name}" neste número. Crie um modelo novo com outro nome.`
          : "Erro ao duplicar: " + (error?.message ?? "sem resposta"),
      );
      return;
    }
    toast.success(comoNovaVersao ? `Nova versão criada como rascunho: ${nome}` : `Cópia criada como rascunho: ${nome}`);
    void fetchTemplates();
    if (comoNovaVersao) openEdit(nova);
  };

  const openShare = (t: WhatsAppTemplate) => {
    setShareTarget(t);
  };


  const handleDelete = async () => {
    if (!deleteId) return;
    const template = templates.find(t => t.id === deleteId);
    if (!template) return;

    // Primeiro na Meta, no escopo do número DONO da cópia (senão o do seletor).
    // Quando a Meta aceita, a function já apaga a cópia de todos os números da
    // WABA — aí a remoção local abaixo pode não achar mais nada, e está certo.
    let removidoPelaFuncao = false;
    if (template.meta_template_id) {
      try {
        const body: Record<string, unknown> = { action: "delete", template_name: template.name, template_id: template.id };
        const numeroDoModelo = template.whatsapp_number_id || selectedNumero;
        if (numeroDoModelo) body.whatsapp_number_id = numeroDoModelo;
        const { data, error } = await supabase.functions.invoke("manage-whatsapp-templates", { body });
        if (error || (data as CorpoDeErro | null)?.error) {
          toast.error(`Não foi possível excluir na Meta: ${await motivoDoServidor(data, error, "erro desconhecido")}. Removendo apenas localmente.`);
        } else {
          removidoPelaFuncao = true;
          const aviso = (data as { warning?: string } | null)?.warning;
          if (aviso) toast.warning(aviso);
        }
      } catch {
        toast.warning("API Meta indisponível. Removendo apenas localmente.");
      }
    }

    // Aqui nem o erro era lido. Modelo de outro perfil (ou de outro número)
    // sai da Meta e continua na lista, com "excluído" na tela.
    const { data: removidos, error: erroLocal } = await supabase
      .from("crm_whatsapp_templates")
      .delete()
      .eq("id", deleteId)
      .select("id");
    if (erroLocal) {
      toast.error("Erro ao excluir o modelo: " + erroLocal.message);
      return;
    }
    if ((!removidos || removidos.length === 0) && !removidoPelaFuncao) {
      toast.error("Seu perfil não tem permissão para excluir este modelo.");
      return;
    }
    toast.success("Modelo excluído");
    setDeleteId(null);
    fetchTemplates();
  };

  // Variáveis do corpo (sem repetição, na ordem do número = ordem da Meta).
  const indicesNoCorpo = useMemo(() => indicesDasVariaveis(form.body_text), [form.body_text]);

  /** Amostra padrão de {{n}} (a de {{2}} lê a frase antes da 1ª ocorrência). */
  const amostraPadrao = useCallback((n: number, texto: string): string => {
    const v = variaveis.find((x) => x.index === n);
    const padrao = v?.sample ?? `Exemplo ${n}`;
    if (n !== 2) return padrao;
    const achado = /\{\{\s*2\s*\}\}/.exec(texto);
    return amostraDaDataNoTexto(achado ? texto.slice(0, achado.index) : "", padrao);
  }, [variaveis]);

  const amostraDe = (n: number): string => form.amostras[n]?.trim() || amostraPadrao(n, form.body_text);

  const fecharEditor = () => {
    setModalOpen(false);
    resetForm();
    void fetchTemplates();
  };

  /**
   * Salvar rascunho / enviar para aprovação (AUTO-12).
   *  - Rascunho: grava (novo ou o mesmo) no número escolhido — é por número +
   *    nome + idioma que o manage-whatsapp-templates acha o rascunho ao enviar.
   *  - Enviar: rascunho existente é gravado antes (com o número) e o modelo vai
   *    à Meta por manage-whatsapp-templates (action create) com as amostras.
   *  - O editor só fecha quando deu certo; `submitting` sempre volta (finally).
   *  - Modelo que já está na Meta nunca chega aqui (só leitura, AUTO-13).
   */
  const handleSave = async (submit: boolean) => {
    if (submitting || somenteLeitura) return;
    const nameRegex = /^[a-z0-9_]+$/;
    if (!form.name || !nameRegex.test(form.name)) {
      toast.error("Nome deve conter apenas letras minúsculas, números e underscore");
      return;
    }
    if (!form.body_text) {
      toast.error("O corpo da mensagem é obrigatório");
      return;
    }
    if (form.hasHeader && (!form.header_type || !form.header_content)) {
      toast.error("Escolha o tipo do cabeçalho e preencha o conteúdo (ou desligue o cabeçalho).");
      return;
    }
    // Botão de formulário: sem id e sem tela de entrada o modelo é aceito aqui
    // e não abre nada no celular. A Meta também não deixa misturar com outros.
    const botoesDeFormulario = form.buttons.filter(b => b.type === "FLOW");
    if (botoesDeFormulario.length > 0) {
      if (botoesDeFormulario.some(b => !b.flow_id || !b.navigate_screen)) {
        toast.error("Escolha qual formulário o botão abre.");
        return;
      }
      if (form.buttons.length > 1) {
        toast.error("Modelo com formulário só aceita esse botão sozinho.");
        return;
      }
    }
    if (submit && !formNumeroId) {
      toast.error("Escolha o número de WhatsApp que vai usar este modelo.");
      return;
    }

    const conteudo = {
      name: form.name, category: form.category, language: form.language,
      header_type: form.hasHeader ? form.header_type : null,
      header_content: form.hasHeader ? form.header_content : null,
      body_text: form.body_text, footer_text: form.footer_text || null,
      buttons: form.buttons.length > 0 ? form.buttons : null,
    };
    const erroDeGravacao = (e: { code?: string; message: string }) =>
      e.code === "23505"
        ? "Já existe um modelo com este nome e idioma neste número. Troque o nome."
        : "Erro ao salvar: " + e.message;

    setSubmitting(true);
    try {
      const rascunhoId = form.id || null;

      // 1) Rascunho gravado no número escolhido (o existente, ou um novo).
      if (rascunhoId) {
        const { data: atualizados, error } = await supabase
          .from("crm_whatsapp_templates")
          .update({
            ...conteudo,
            buttons: (conteudo.buttons ?? null) as Json,
            whatsapp_number_id: formNumeroId || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", rascunhoId)
          .is("meta_template_id", null)
          .select("id");
        if (error) { toast.error(erroDeGravacao(error)); return; }
        if (!atualizados || atualizados.length === 0) {
          toast.error("Seu perfil não tem permissão para editar este modelo.");
          return;
        }
      } else if (!submit) {
        const { data: { user: atual } } = await supabase.auth.getUser();
        let ownerRole: string | null = null;
        if (atual) {
          const { data: roleRow } = await supabase.rpc("get_user_primary_role", { _user_id: atual.id });
          ownerRole = (roleRow as string) || null;
        }
        const { error } = await supabase.from("crm_whatsapp_templates").insert([{
          ...conteudo,
          buttons: (conteudo.buttons ?? null) as Json,
          status: "DRAFT",
          created_by_user_id: atual?.id || null,
          owner_role: ownerRoleParaGravar(ownerRole) as PapelApp | null,
          whatsapp_number_id: formNumeroId || null,
          updated_at: new Date().toISOString(),
        }]);
        if (error) { toast.error(erroDeGravacao(error)); return; }
      }

      if (!submit) {
        toast.success("Rascunho salvo");
        fecharEditor();
        return;
      }

      // 2) Envio à Meta pelo número escolhido, com as amostras das variáveis.
      const { data, error: fnError } = await supabase.functions.invoke("manage-whatsapp-templates", {
        body: {
          action: "create",
          whatsapp_number_id: formNumeroId,
          ...conteudo,
          body_examples: indicesNoCorpo.map(amostraDe),
        },
      });
      if (fnError || (data as CorpoDeErro | null)?.error) {
        toast.error(
          "Não foi possível enviar à Meta: " + (await motivoDoServidor(data, fnError, "erro desconhecido")),
          { duration: 10000 },
        );
        return;
      }

      // 3) Rascunho que não virou a linha enviada (não deveria acontecer) sai,
      // para não ficar órfão ao lado do modelo.
      const idGravado = (data as { id?: string | null } | null)?.id ?? null;
      if (rascunhoId && idGravado && idGravado !== rascunhoId) {
        await supabase.from("crm_whatsapp_templates").delete().eq("id", rascunhoId).is("meta_template_id", null);
      }

      toast.success("Modelo enviado à Meta para aprovação (Pendente). A lista atualiza em instantes.", { duration: 6000 });
      setTimeout(() => { void handleSync(true); }, 5000);
      fecharEditor();
    } catch (e: unknown) {
      toast.error("Erro ao salvar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSubmitting(false);
    }
  };

  // Formulários da Meta só com número escolhido (sem número a chamada só
  // devolvia 403 no console — POS-18).
  useEffect(() => {
    if (!modalOpen || !selectedNumero) {
      setFormularios([]);
      return;
    }
    let cancelado = false;
    setCarregandoFormularios(true);
    const body: Record<string, unknown> = { action: "list_flows", whatsapp_number_id: selectedNumero };
    supabase.functions
      .invoke("manage-whatsapp-templates", { body })
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) { setFormularios([]); return; }
        setFormularios(((data as { flows?: FormularioDaMeta[] } | null)?.flows ?? []) as FormularioDaMeta[]);
      })
      .finally(() => { if (!cancelado) setCarregandoFormularios(false); });
    return () => { cancelado = true; };
  }, [modalOpen, selectedNumero]);

  const addButton = () => {
    if (form.buttons.length >= 3) return;
    setForm(p => ({ ...p, buttons: [...p.buttons, { type: "QUICK_REPLY", text: "" }] }));
  };

  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [variablePopoverOpen, setVariablePopoverOpen] = useState(false);

  const insertVariableAt = (index: number) => {
    const placeholder = `{{${index}}}`;
    const el = bodyTextareaRef.current;
    if (!el) {
      setForm(p => ({ ...p, body_text: (p.body_text || "") + placeholder }));
      setVariablePopoverOpen(false);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const current = form.body_text || "";
    const next = current.slice(0, start) + placeholder + current.slice(end);
    setForm(p => ({ ...p, body_text: next }));
    setVariablePopoverOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + placeholder.length;
      el.setSelectionRange(pos, pos);
    });
  };

  // Render preview substituindo {{N}} pelas amostras (as digitadas; sem elas,
  // o padrão de cada variável).
  const renderPreviewBody = (text: string) => {
    if (!text) return "Corpo da mensagem...";
    return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n, pos: number) => {
      const num = Number(n);
      const digitada = form.amostras[num]?.trim();
      if (digitada) return digitada;
      const v = variaveis.find(v => v.index === num);
      if (!v) return `{{${n}}}`;
      // Mesma regra do servidor (_shared/modeloEnviado.ts) para {{2}}: depois de
      // "às" vai só a hora; depois de "hoje"/"amanhã", "às 14:00".
      if (num === 2) return amostraDaDataNoTexto(text.slice(0, pos), v.sample);
      return v.sample;
    });
  };

  // Detecta placeholders inválidos digitados manualmente (ex: [nome])
  const hasInvalidPlaceholders = (text: string) => /\[[^\]]+\]/.test(text || "");


  const statusBadge = (s: string, metaTemplateId: string | null) => {
    // Sem o id da Meta a linha nunca foi à Meta (todo caminho que a manda
    // grava meta_template_id): é rascunho, qualquer que seja o status gravado
    // (seed, cópia antiga "Pendente"). Abre como rascunho e pode ser enviada.
    if (s !== "DRAFT" && !metaTemplateId) {
      return <span title="Ainda não está na Meta — abra e envie para aprovação" className="cursor-help rounded-full bg-slate-soft px-2.5 py-1 text-[10px] font-semibold text-slate-soft-foreground">Rascunho</span>;
    }
    if (s === "APPROVED") return <span title="Aprovado pela Meta — pronto para uso" className="cursor-help rounded-full bg-success-soft px-2.5 py-1 text-[10px] font-semibold text-success-soft-foreground">Aprovado</span>;
    if (s === "PENDING") return <span title="Em análise pela Meta (pode levar até 24h). Clique em 'Sincronizar com Meta' para atualizar." className="cursor-help rounded-full bg-warning-soft px-2.5 py-1 text-[10px] font-semibold text-warning-soft-foreground">Pendente</span>;
    if (s === "DRAFT") return <span title="Rascunho local — ainda não enviado à Meta" className="cursor-help rounded-full bg-slate-soft px-2.5 py-1 text-[10px] font-semibold text-slate-soft-foreground">Rascunho</span>;
    if (s === "PAUSED") return <span title="Modelo pausado pela Meta" className="cursor-help rounded-full bg-purple-soft px-2.5 py-1 text-[10px] font-semibold text-purple-soft-foreground">Pausado</span>;
    return <span title="Rejeitado pela Meta — duplique como nova versão, ajuste e envie de novo" className="cursor-help rounded-full bg-destructive-soft px-2.5 py-1 text-[10px] font-semibold text-destructive-soft-foreground">Rejeitado</span>;
  };

  const categoryBadge = (c: string) => {
    const colors: Record<string, string> = {
      MARKETING: "bg-purple-soft text-purple-soft-foreground",
      UTILITY: "bg-info-soft text-info-soft-foreground",
      AUTHENTICATION: "bg-success-soft text-success-soft-foreground",
    };
    return <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${colors[c] || "bg-secondary text-muted-foreground"}`}>{c === "MARKETING" ? "Marketing" : c === "UTILITY" ? "Utilidade" : "Autenticação"}</span>;
  };

  const headerIcon = (type: string | null) => {
    if (type === "IMAGE") return <Image size={12} className="text-muted-foreground" />;
    if (type === "DOCUMENT") return <FileText size={12} className="text-muted-foreground" />;
    return null;
  };

  return (
    <div className="flex flex-col overflow-hidden bg-background -m-2 sm:-m-4 lg:-m-6" style={{ height: "calc(100vh - 4rem)" }}>
      {/* Header - FIXED (quebra em linhas no celular — REC-12) */}
      <div className="flex-shrink-0 bg-background px-3 pb-4 pt-4 sm:px-6 lg:pt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-4 min-w-0">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-foreground sm:text-[32px]">Modelos de Mensagem</h1>
          {numeros.length > 1 && (
            <Select value={selectedNumero} onValueChange={(v) => { setSelectedNumero(v); setPage(0); }}>
               <SelectTrigger className="h-10 w-full rounded-xl bg-card text-sm shadow-xs sm:w-[260px]" aria-label="Número de WhatsApp">
                <SelectValue placeholder="Selecione o número" />
              </SelectTrigger>
              <SelectContent>
                {numeros.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {rotuloDoNumero(n)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lastSyncAt && (
            <span className="text-[11px] text-muted-foreground" title={lastSyncAt.toLocaleString("pt-BR")}>
              Última sinc: {lastSyncAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {/* Sincronizar apaga localmente o que sumiu da Meta, inclusive modelos
              que a SDR não enxerga — a função recusa e o botão não aparece.
              Sem número conectado fica desabilitado, com a dica (POS-18). */}
          {userRole !== "sdr" && (
            <span title={semNumero ? "Nenhum número conectado" : undefined}>
               <Button size="sm" variant="outline" className="h-10 rounded-xl bg-card shadow-xs" onClick={() => handleSync(false)} disabled={syncing || semNumero}>
                <RefreshCw size={14} className={`mr-1 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Sincronizando..." : "Sincronizar com Meta"}
              </Button>
            </span>
          )}
           <Button size="sm" className="h-10 rounded-xl shadow-brand" onClick={() => { resetForm(); setFormNumeroId(selectedNumero); setModalOpen(true); }}>
            <Plus size={14} className="mr-1" /> Novo Modelo
          </Button>
        </div>
      </div>

      {/* Tabs + Filters - FIXED */}
      <div className="mx-3 flex-shrink-0 rounded-card border border-border/60 bg-card px-3 py-3 shadow-card sm:mx-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
           <div className="flex gap-1 rounded-full bg-surface-sunken p-1">
            {["todos", "aprovados", "pendentes"].map(t => (
              <button key={t} onClick={() => { setTab(t); setPage(0); }}
                 className={`rounded-full px-3 py-1.5 text-sm transition-colors ${tab === t ? "bg-card text-primary-soft-fg font-semibold shadow-xs" : "text-muted-foreground hover:text-foreground"}`}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
               <input className="h-10 w-48 rounded-xl border border-border/60 bg-surface-sunken py-1 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Buscar por nome..." value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
            </div>
             <select className="h-10 rounded-xl border border-border/60 bg-surface-sunken px-3 text-sm text-foreground" value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(0); }}>
              <option value="all">Todas categorias</option>
              <option value="MARKETING">Marketing</option>
              <option value="UTILITY">Utilidade</option>
              <option value="AUTHENTICATION">Autenticação</option>
            </select>
          </div>
        </div>
      </div>

      {/* Grid - SCROLLABLE */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6">
        {loading ? <div className="text-center text-muted-foreground py-10">Carregando...</div> : paginated.length === 0 ? <div className="text-center text-muted-foreground py-10">Nenhum modelo encontrado</div> : (
          <div className="overflow-hidden rounded-card border border-border/60 bg-card shadow-card">
            {paginated.map(t => (
              <div key={t.id} className="border-b border-border/60 p-4 transition-colors last:border-b-0 hover:bg-surface-sunken/50 sm:p-5">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div className="break-words text-sm font-semibold text-foreground" title={t.name}>{cleanTemplateName(t.name)}</div>
                  <div className="flex items-center gap-1">{headerIcon(t.header_type)}</div>
                </div>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {categoryBadge(t.category)}
                  {statusBadge(t.status, t.meta_template_id)}
                  {t.owner_role
                    ? <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${ROLE_BADGE_COLOR[t.owner_role] || "bg-secondary text-muted-foreground"}`}>{ROLE_LABEL[t.owner_role]}</span>
                    : <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-secondary text-muted-foreground">Compartilhado</span>}
                </div>
                <div className="mb-3 max-w-xl min-w-0 rounded-2xl rounded-tl-md border border-border/60 bg-surface-sunken px-3.5 py-3 text-xs leading-relaxed text-muted-foreground shadow-xs"><p className="line-clamp-3 break-words whitespace-pre-wrap">{t.body_text || "Sem corpo"}</p></div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">{new Date(t.created_at).toLocaleDateString("pt-BR")}</span>
                  <div className="flex items-center gap-1">
                    {t.meta_template_id ? (
                      <button onClick={() => openEdit(t)} title="Ver modelo (já está na Meta)" className="p-1 hover:bg-secondary rounded transition-colors"><Eye size={14} className="text-muted-foreground" /></button>
                    ) : podeEditarItem(t) && (
                      <button onClick={() => openEdit(t)} title="Editar rascunho" className="p-1 hover:bg-secondary rounded transition-colors"><Pencil size={14} className="text-muted-foreground" /></button>
                    )}
                    <button onClick={() => handleDuplicate(t)} title="Duplicar como rascunho" className="p-1 hover:bg-secondary rounded transition-colors"><Copy size={14} className="text-muted-foreground" /></button>
                    {canShare && (
                      <button onClick={() => openShare(t)} title="Compartilhar com papel" className="p-1 hover:bg-secondary rounded transition-colors"><Users size={14} className="text-muted-foreground" /></button>
                    )}
                    {podeEditarItem(t) && (
                      <button onClick={() => setDeleteId(t.id)} title="Excluir modelo" className="p-1 hover:bg-destructive/20 rounded transition-colors"><Trash2 size={14} className="text-destructive" /></button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-1 text-muted-foreground disabled:opacity-30"><ChevronLeft size={18} /></button>
            <span className="text-sm text-muted-foreground">{page + 1} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="p-1 text-muted-foreground disabled:opacity-30"><ChevronRight size={18} /></button>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
       <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader><DialogTitle>Excluir modelo?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Esta ação não pode ser desfeita.</p>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete}>Excluir</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Share with role */}
      <ShareRoleDialog
        open={!!shareTarget}
        onOpenChange={(v) => !v && setShareTarget(null)}
        table="crm_whatsapp_templates"
        rowId={shareTarget?.id ?? null}
        currentOwnerRole={(shareTarget?.owner_role ?? null) as OwnerRole}
        currentSharedRoles={(shareTarget?.shared_roles ?? []) as string[]}
        itemLabel="Modelo"
        onSaved={fetchTemplates}
      />


      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
         <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>{somenteLeitura ? "Modelo na Meta" : form.id ? "Editar rascunho" : "Novo Modelo"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Form */}
            <div className="space-y-3 min-w-0">
              {somenteLeitura && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  Este modelo já foi enviado à Meta{form.status === "APPROVED" ? " e está aprovado" : form.status === "REJECTED" ? " e foi rejeitado" : ""}.
                  A Meta não deixa mudar nome, idioma, categoria nem o texto por aqui. Para alterar, duplique como nova
                  versão (vira rascunho), ajuste e envie para aprovação.
                </div>
              )}
              {/* fieldset disabled: com o modelo na Meta, todos os campos ficam só leitura (AUTO-13). */}
              <fieldset disabled={somenteLeitura} className="space-y-3 min-w-0">
              <div>
                <Label>Nome do modelo *</Label>
                <Input className="font-mono text-sm" placeholder="boas_vindas_lead" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") }))} />
                <span className="text-[10px] text-muted-foreground">Apenas letras minúsculas, números e _</span>
              </div>
              <div>
                <Label>Número de WhatsApp *</Label>
                <Select value={formNumeroId} onValueChange={setFormNumeroId} disabled={somenteLeitura}>
                  <SelectTrigger><SelectValue placeholder="Selecione o número" /></SelectTrigger>
                  <SelectContent>
                    {numeros.map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        {rotuloDoNumero(n)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-[10px] text-muted-foreground">O modelo será criado e enviado à Meta por este número.</span>
              </div>
              <div>
                <Label>Categoria</Label>
                <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))} disabled={somenteLeitura}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MARKETING">Marketing</SelectItem>
                    <SelectItem value="UTILITY">Utilidade</SelectItem>
                    <SelectItem value="AUTHENTICATION">Autenticação</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Idioma</Label>
                <Select value={form.language} onValueChange={v => setForm(p => ({ ...p, language: v }))} disabled={somenteLeitura}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pt_BR">Português (BR)</SelectItem>
                    <SelectItem value="en_US">English (US)</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Header */}
              <div className="flex items-center gap-2">
                <Switch checked={form.hasHeader} onCheckedChange={v => setForm(p => ({ ...p, hasHeader: v }))} disabled={somenteLeitura} />
                <Label>Cabeçalho</Label>
              </div>
              {form.hasHeader && (
                <div className="space-y-2 pl-4 border-l-2 border-border">
                  {/* Só o que a Meta aceita em modelo: sem Áudio (AUTO-15). */}
                  <Select value={form.header_type} onValueChange={v => setForm(p => ({ ...p, header_type: v }))} disabled={somenteLeitura}>
                    <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TEXT">Texto</SelectItem>
                      <SelectItem value="IMAGE">Imagem</SelectItem>
                      <SelectItem value="VIDEO">Vídeo</SelectItem>
                      <SelectItem value="DOCUMENT">Documento</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.header_type === "TEXT" ? (
                    <Input placeholder="Conteúdo do cabeçalho" value={form.header_content} onChange={e => setForm(p => ({ ...p, header_content: e.target.value }))} />
                  ) : form.header_type ? (
                    <TemplateMediaHeader
                      headerType={form.header_type}
                      headerContent={form.header_content}
                      onChange={(handle) => setForm(p => ({ ...p, header_content: handle }))}
                      numeroId={selectedNumero}
                    />
                  ) : null}
                </div>
              )}

              {/* Body */}
              <div>
                <div className="flex items-center justify-between">
                  <Label>Corpo da mensagem</Label>
                  <Popover open={variablePopoverOpen} onOpenChange={setVariablePopoverOpen}>
                    <PopoverTrigger asChild>
                      <button type="button" className="text-xs text-primary hover:underline">+ Variável</button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72 p-1">
                      <div className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Inserir variável dinâmica
                      </div>
                      {variaveis.map(v => (
                        <button
                          key={v.index}
                          type="button"
                          onClick={() => insertVariableAt(v.index)}
                          className="w-full text-left px-2 py-1.5 rounded hover:bg-secondary transition-colors group"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-foreground">{v.label}</span>
                            <code className="text-[10px] bg-secondary group-hover:bg-background px-1.5 py-0.5 rounded text-primary font-mono">{`{{${v.index}}}`}</code>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Exemplo: {v.sample}</p>
                        </button>
                      ))}
                      <div className="px-2 py-1.5 mt-1 border-t border-border text-[10px] text-muted-foreground">
                        A Meta só substitui <code className="font-mono">{`{{N}}`}</code>. Texto como <code className="font-mono">[nome]</code> é enviado literal.
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <Textarea
                  ref={bodyTextareaRef}
                  rows={5}
                  placeholder="Olá {{1}}, tudo bem?"
                  value={form.body_text}
                  onChange={e => setForm(p => ({ ...p, body_text: e.target.value }))}
                />
                {hasInvalidPlaceholders(form.body_text) && (
                  <p className="text-[11px] text-destructive mt-1">
                    ⚠ Detectamos texto entre colchetes (ex: <code className="font-mono">[nome]</code>). Isso será enviado literalmente ao paciente. Use o botão <strong>+ Variável</strong> e troque por <code className="font-mono">{`{{1}}`}</code>, <code className="font-mono">{`{{2}}`}</code>, etc.
                  </p>
                )}
              </div>

              {/* Amostras das variáveis — vão à Meta junto do modelo (AUTO-14). */}
              {!somenteLeitura && indicesNoCorpo.length > 0 && (
                <div className="space-y-1.5 rounded-md border border-border p-2">
                  <Label className="text-xs">Exemplos para a Meta aprovar</Label>
                  <p className="text-[10px] text-muted-foreground">
                    A Meta avalia o modelo com estes exemplos. Use valores reais do dia a dia da clínica.
                  </p>
                  {indicesNoCorpo.map((n) => {
                    const v = variaveis.find((x) => x.index === n);
                    return (
                      <div key={n} className="flex items-center gap-2">
                        <code className="text-[10px] bg-secondary px-1.5 py-0.5 rounded text-primary font-mono shrink-0">{`{{${n}}}`}</code>
                        <Input
                          className="h-8 text-sm"
                          aria-label={`Exemplo de {{${n}}}${v ? ` (${v.label})` : ""}`}
                          placeholder={amostraPadrao(n, form.body_text)}
                          value={form.amostras[n] ?? ""}
                          onChange={(e) => {
                            const valor = e.target.value;
                            setForm((p) => ({ ...p, amostras: { ...p.amostras, [n]: valor } }));
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Footer */}
              <div>
                <Label>Rodapé (opcional)</Label>
                <Input placeholder="Ex.: Equipe da clínica" value={form.footer_text} onChange={e => setForm(p => ({ ...p, footer_text: e.target.value }))} />
              </div>

              {/* Buttons */}
              <div>
                <div className="flex items-center justify-between">
                  <Label>Botões (máx 3)</Label>
                  {!somenteLeitura && form.buttons.length < 3 && <button type="button" onClick={addButton} className="text-xs text-primary hover:underline">+ Botão</button>}
                </div>
                {form.buttons.map((btn, i) => {
                  const formularioDoBotao = formularios.find(f => String(f.id) === String(btn.flow_id ?? ""));
                  return (
                  <div key={i} className="mt-1 space-y-1">
                    <div className="flex gap-2 items-center">
                    <select className="text-sm border border-border rounded px-2 py-1 bg-secondary text-foreground" value={btn.type} onChange={e => {
                      const tipo = e.target.value;
                      const nb = [...form.buttons];
                      // Sair de "Formulário" leva junto o id e a tela: um botão
                      // de link com flow_id pendurado é recusado pela Meta.
                      nb[i] = tipo === "FLOW"
                        ? { ...nb[i], type: tipo }
                        : { type: tipo, text: nb[i].text, url: nb[i].url };
                      setForm(p => ({ ...p, buttons: nb }));
                    }}>
                      <option value="QUICK_REPLY">Resposta rápida</option>
                      <option value="URL">URL</option>
                      <option value="FLOW">Formulário</option>
                    </select>
                    <Input className="flex-1 text-sm" placeholder="Texto" value={btn.text} onChange={e => {
                      const nb = [...form.buttons]; nb[i] = { ...nb[i], text: e.target.value }; setForm(p => ({ ...p, buttons: nb }));
                    }} />
                    {btn.type === "URL" && <Input className="flex-1 text-sm" placeholder="https://..." value={btn.url || ""} onChange={e => {
                      const nb = [...form.buttons]; nb[i] = { ...nb[i], url: e.target.value }; setForm(p => ({ ...p, buttons: nb }));
                    }} />}
                    {!somenteLeitura && (
                      <button type="button" onClick={() => setForm(p => ({ ...p, buttons: p.buttons.filter((_, j) => j !== i) }))}><Trash2 size={14} className="text-destructive" /></button>
                    )}
                    </div>
                    {btn.type === "FLOW" && (
                      <div className="flex gap-2 items-center pl-1">
                        <select
                          className="text-sm border border-border rounded px-2 py-1 bg-secondary text-foreground flex-1"
                          value={String(btn.flow_id ?? "")}
                          onChange={e => {
                            const escolhido = formularios.find(f => String(f.id) === e.target.value);
                            const nb = [...form.buttons];
                            nb[i] = {
                              ...nb[i],
                              flow_id: e.target.value,
                              flow_action: "navigate",
                              // Tela de entrada: a primeira do formulário, que é
                              // o que a Meta exige no botão (erro 2388202).
                              navigate_screen: escolhido?.telas?.[0]?.id ?? "",
                            };
                            setForm(p => ({ ...p, buttons: nb }));
                          }}
                        >
                          <option value="">
                            {carregandoFormularios ? "Carregando formulários…" : !selectedNumero ? "Nenhum número conectado" : "Escolha o formulário"}
                          </option>
                          {/* Formulário que o modelo já usa mas não veio na lista
                              (outra conexão, ou despublicado): mantém a escolha. */}
                          {btn.flow_id && !formularioDoBotao && (
                            <option value={String(btn.flow_id)}>Formulário {String(btn.flow_id)} (atual)</option>
                          )}
                          {formularios.map(f => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                          ))}
                        </select>
                        {formularioDoBotao && formularioDoBotao.telas.length > 1 && (
                          <select
                            className="text-sm border border-border rounded px-2 py-1 bg-secondary text-foreground"
                            value={btn.navigate_screen ?? ""}
                            onChange={e => {
                              const nb = [...form.buttons];
                              nb[i] = { ...nb[i], navigate_screen: e.target.value };
                              setForm(p => ({ ...p, buttons: nb }));
                            }}
                          >
                            {formularioDoBotao.telas.map(t => (
                              <option key={t.id} value={t.id}>Abre em: {t.title}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })}
                {form.buttons.some(b => b.type === "FLOW") && (
                  <p className="text-xs text-muted-foreground mt-1">
                    O formulário precisa estar publicado na Meta. Modelo com formulário só aceita esse botão sozinho.
                  </p>
                )}
              </div>
              </fieldset>

              <div className="flex flex-wrap gap-2 pt-2">
                {somenteLeitura ? (
                  <>
                    <Button variant="outline" className="flex-1" onClick={() => setModalOpen(false)}>Fechar</Button>
                    <Button
                      className="flex-1"
                      onClick={() => {
                        const original = templates.find((t) => t.id === form.id);
                        if (original) void handleDuplicate(original, true);
                      }}
                    >
                      <Copy size={14} className="mr-1" /> Duplicar como nova versão
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" className="flex-1" disabled={submitting} onClick={() => handleSave(false)}>
                      Salvar rascunho
                    </Button>
                    <span className="flex-1" title={!selectedNumero ? "Nenhum número conectado" : undefined}>
                      <Button
                        className="w-full bg-success text-success-foreground hover:bg-success/90"
                        disabled={submitting || !selectedNumero}
                        onClick={() => handleSave(true)}
                      >
                        {submitting ? "Enviando…" : "Enviar para aprovação"}
                      </Button>
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Right: Preview */}
            <div className="flex flex-col items-center rounded-2xl bg-surface-sunken p-4">
              <span className="text-xs text-muted-foreground mb-3">Prévia</span>
              <div className="w-full max-w-[300px]">
                <div className="min-w-0 overflow-hidden rounded-2xl rounded-tl-md border border-border/60 bg-card p-3 text-sm shadow-card">
                  {form.hasHeader && form.header_content && (
                    <div className="font-semibold text-foreground mb-1 text-xs">
                      {form.header_type === "IMAGE" ? <div className="bg-secondary rounded h-20 flex items-center justify-center text-muted-foreground mb-1"><Image size={24} /></div> : null}
                      {form.header_type === "VIDEO" ? <div className="bg-secondary rounded h-20 flex items-center justify-center text-muted-foreground mb-1"><span className="text-2xl">🎬</span></div> : null}
                      {form.header_type === "TEXT" ? form.header_content : null}
                    </div>
                  )}
                  <p className="text-foreground text-xs whitespace-pre-wrap">{renderPreviewBody(form.body_text)}</p>
                  {form.footer_text && <p className="text-[10px] text-muted-foreground mt-1">{form.footer_text}</p>}
                </div>
                {form.buttons.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {form.buttons.map((btn, i) => (
                      <div key={i} className="bg-card rounded shadow-card border border-border py-2 text-center text-primary text-xs font-medium">{btn.text || "Botão"}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
