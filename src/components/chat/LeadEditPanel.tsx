import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getLeadChannel } from "@/lib/leadChannel";
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

type AdOption = {
  ad_id: string;
  imagem_origem: string | null;
  nome_anuncio: string | null;
  descricao_anuncio: string | null;
  link_anuncio: string | null;
  ad_account_id: string | null;
  ad_account_name: string | null;
};

type Props = {
  lead: Lead;
  onLeadUpdated: (lead: Lead) => void;
  onLeadDeleted: () => void;
};


const SOURCE_OPTIONS_DEFAULT = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "facebook_ad", label: "Anúncio Facebook" },
  { value: "instagram_ad", label: "Anúncio Instagram" },
  { value: "indicação", label: "Indicação" },
  { value: "orgânico", label: "Orgânico" },
  { value: "site", label: "Site" },
  { value: "ligação", label: "Ligação" },
  { value: "outro", label: "Outro" },
];

const SOURCE_OPTIONS_INSTAGRAM = [
  { value: "comentário", label: "Comentário" },
  { value: "direct", label: "Direct" },
  { value: "anúncio", label: "Anúncio" },
];

export default function LeadEditPanel({ lead, onLeadUpdated, onLeadDeleted }: Props) {
  const { user } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState(lead.name);
  const [phone, setPhone] = useState(lead.phone || "");
  const [source, setSource] = useState(lead.source || "");
  const [customSource, setCustomSource] = useState("");
  const [value, setValue] = useState(lead.value?.toString() || "");
  const [tags, setTags] = useState<string[]>(lead.tags || []);
  const [newTag, setNewTag] = useState("");
  const [notes, setNotes] = useState(lead.notes || "");

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

  const isInstagramLead = getLeadChannel(lead) === "instagram";
  const SOURCE_OPTIONS = isInstagramLead ? SOURCE_OPTIONS_INSTAGRAM : SOURCE_OPTIONS_DEFAULT;
  const isKnownSource = SOURCE_OPTIONS.some((o) => o.value === source);
  const effectiveSource = isKnownSource ? source : (SOURCE_OPTIONS.some((o) => o.value === "outro") ? "outro" : "");

  useEffect(() => {
    if (editOpen) {
      setName(lead.name);
      setPhone(lead.phone || "");
      const s = lead.source || "";
      setSource(s);
      setCustomSource(SOURCE_OPTIONS.some((o) => o.value === s) ? "" : s);
      setValue(lead.value?.toString() || "");
      setTags(lead.tags || []);
      setNotes(lead.notes || "");
      setNewTag("");
      setAdId(lead.ad_id || "");
      setImagemOrigem(lead.imagem_origem || "");
      setNomeAnuncio(lead.nome_anuncio || "");
      setDescricaoAnuncio(lead.descricao_anuncio || "");
      setLinkAnuncio(lead.link_anuncio || "");
      setAdAccountId(lead.ad_account_id || "");
      setAdAccountName(lead.ad_account_name || "");
      setShowAdSelector(false);
    }
  }, [editOpen, lead]);

  const normalizeImgUrl = (url: string | null) => {
    if (!url) return "no-img";
    try { return new URL(url).origin + new URL(url).pathname; } catch { return url; }
  };

  const loadAds = async () => {
    setLoadingAds(true);
    const seen = new Map<string, AdOption>();
    // Only look at recent rows — the RLS already isolates by tenant, but old rows bloat the dedupe set.
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // Run both queries in parallel (cuts wall time roughly in half)
    const [{ data: leadsData }, { data: msgData }] = await Promise.all([
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
    ]);

    if (leadsData) {
      for (const row of leadsData) {
        const key = `${normalizeImgUrl(row.imagem_origem)}::${row.descricao_anuncio || row.ad_id}::${(row as any).ad_account_id || ""}`;
        if (!seen.has(key)) {
          seen.set(key, {
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
        const key = `${normalizeImgUrl(row.ad_image_url)}::${row.ad_body || row.ad_source_id}::${(row as any).ad_account_id || ""}`;
        if (!seen.has(key)) {
          seen.set(key, {
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

    setAds(Array.from(seen.values()));
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

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    setSaving(true);
    const finalSource = effectiveSource === "outro" ? (customSource.trim() || "outro") : source;
    const updates = {
      name: name.trim().toUpperCase(),
      phone: phone.trim() || null,
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
    const { error } = await supabase.from("crm_leads").update(updates).eq("id", lead.id);
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar lead");
      return;
    }
    onLeadUpdated({ ...lead, ...updates } as Lead);
    setEditOpen(false);
    toast.success("Lead atualizado");
  };

  const handleDelete = async () => {
    const { error } = await supabase.from("crm_leads").delete().eq("id", lead.id);
    if (error) {
      toast.error("Erro ao excluir lead");
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
      <div className="flex gap-1">
        <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
          <Pencil size={14} className="mr-1" /> Editar
        </Button>
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" title="Bloquear lead" onClick={() => setBlockOpen(true)}>
          <Ban size={14} />
        </Button>
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" title="Excluir lead" onClick={() => setDeleteOpen(true)}>
          <Trash2 size={14} />
        </Button>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Lead</DialogTitle>
            <DialogDescription>Atualize as informações do lead.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Nome *</label>
              <Input value={name} onChange={(e) => setName(e.target.value.toUpperCase())} style={{ textTransform: "uppercase" }} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Telefone</label>
              <div className="flex gap-2">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="5511999999999" />
                {isInstagramLead && phone.trim() && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    title="Enviar mensagem via WhatsApp"
                    onClick={async () => {
                      const text = window.prompt("Mensagem WhatsApp para enviar:");
                      if (!text || !text.trim()) return;
                      try {
                        // Save phone first if changed
                        if (phone.trim() !== (lead.phone || "")) {
                          await supabase.from("crm_leads").update({ phone: phone.trim() }).eq("id", lead.id);
                        }
                        const { data, error } = await supabase.functions.invoke("send-whatsapp-message", {
                          body: { lead_id: lead.id, to: phone.trim(), message: text, type: "text" },
                        });
                        if (error || (data as any)?.error) {
                          toast.error((data as any)?.user_message || (data as any)?.error || error?.message || "Erro ao enviar");
                          return;
                        }
                        toast.success("Mensagem WhatsApp enviada");
                      } catch (e: any) {
                        toast.error(e?.message || "Erro ao enviar");
                      }
                    }}
                  >
                    <MessageCircle size={14} className="mr-1" /> WhatsApp
                  </Button>
                )}
              </div>
              {isInstagramLead && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  As mensagens WhatsApp aparecem nesta mesma conversa e também na aba WhatsApp.
                </p>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Origem</label>
              <Select value={effectiveSource} onValueChange={(v) => { setSource(v); if (v !== "outro") setCustomSource(""); }}>
                <SelectTrigger>
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
                  className="mt-2"
                  value={customSource}
                  onChange={(e) => setCustomSource(e.target.value)}
                  placeholder="Especifique a origem..."
                />
              )}
            </div>

            {/* Ad linking */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Vincular a Anúncio</label>
              {adId ? (
                <div className="border rounded-md p-2 space-y-2">
                  <div className="flex items-start gap-2">
                    {imagemOrigem ? (
                      <img src={imagemOrigem} alt="Anúncio" className="w-16 h-16 rounded object-cover shrink-0" />
                    ) : (
                      <div className="w-16 h-16 rounded bg-muted flex items-center justify-center shrink-0">
                        <Video size={20} className="text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{nomeAnuncio || "Anúncio vinculado"}</p>
                      {adAccountName && (
                        <p className="text-xs text-primary/70">Conta: {adAccountName}</p>
                      )}
                      {descricaoAnuncio && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{descricaoAnuncio}</p>
                      )}
                    </div>
                    <Button size="sm" variant="ghost" onClick={handleUnlinkAd} className="shrink-0 text-destructive hover:text-destructive">
                      <Unlink size={14} />
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={handleOpenAdSelector} className="w-full">
                    <Link2 size={14} className="mr-1" /> Selecionar anúncio
                  </Button>

                  {showAdSelector && (
                    <div className="mt-2 border rounded-md max-h-60 overflow-y-auto">
                      {loadingAds ? (
                        <p className="text-xs text-muted-foreground p-3 text-center">Carregando...</p>
                      ) : ads.length === 0 ? (
                        <p className="text-xs text-muted-foreground p-3 text-center">Nenhum anúncio encontrado</p>
                      ) : (
                        <div className="divide-y">
                          {ads.map((ad) => (
                            <button
                              key={ad.ad_id}
                              type="button"
                              onClick={() => handleSelectAd(ad)}
                              className="w-full flex items-center gap-2 p-2 hover:bg-accent text-left transition-colors"
                            >
                              {ad.imagem_origem ? (
                                <img src={ad.imagem_origem} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
                              ) : (
                                <div className="w-12 h-12 rounded bg-muted flex items-center justify-center shrink-0">
                                  <Video size={16} className="text-muted-foreground" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{ad.nome_anuncio || "Sem nome"}</p>
                                {ad.ad_account_name && (
                                  <p className="text-[11px] text-primary/70 truncate">Conta: {ad.ad_account_name}</p>
                                )}
                                {ad.descricao_anuncio && (
                                  <p className="text-xs text-muted-foreground line-clamp-1">{ad.descricao_anuncio}</p>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Valor (R$)</label>
              <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Tags</label>
              <div className="flex flex-wrap gap-1 mb-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs gap-1">
                    #{tag}
                    <button onClick={() => removeTag(tag)} className="hover:text-destructive">
                      <X size={12} />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  placeholder="Nova tag..."
                  className="text-sm"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                />
                <Button size="sm" variant="outline" onClick={addTag} type="button">
                  <Plus size={14} />
                </Button>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notas</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lead?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso excluirá permanentemente o lead "{lead.name}" e todo o seu histórico de mensagens. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={blockOpen} onOpenChange={setBlockOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bloquear este lead?</AlertDialogTitle>
            <AlertDialogDescription>
              As mensagens recebidas de "{lead.name}" serão descartadas e ele não aparecerá mais no Kanban nem na lista de conversas. Você pode desbloqueá-lo depois em Configurações → Bloqueados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                const { error } = await supabase.from("crm_leads").update({
                  is_blocked: true,
                  blocked_at: new Date().toISOString(),
                  blocked_by: user?.id || null,
                } as any).eq("id", lead.id);
                if (error) { toast.error("Erro ao bloquear: " + error.message); return; }
                toast.success("Lead bloqueado");
                onLeadDeleted();
              }}
            >
              Bloquear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
