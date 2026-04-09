import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { Pencil, Trash2, X, Plus, Link2, Unlink, Video } from "lucide-react";

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
};

type AdOption = {
  ad_id: string;
  imagem_origem: string | null;
  nome_anuncio: string | null;
  descricao_anuncio: string | null;
  link_anuncio: string | null;
};

type Props = {
  lead: Lead;
  onLeadUpdated: (lead: Lead) => void;
  onLeadDeleted: () => void;
};

const SOURCE_OPTIONS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "facebook_ad", label: "Anúncio Facebook" },
  { value: "instagram_ad", label: "Anúncio Instagram" },
  { value: "indicação", label: "Indicação" },
  { value: "orgânico", label: "Orgânico" },
  { value: "site", label: "Site" },
  { value: "ligação", label: "Ligação" },
  { value: "outro", label: "Outro" },
];

export default function LeadEditPanel({ lead, onLeadUpdated, onLeadDeleted }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
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

  // Ad selector
  const [ads, setAds] = useState<AdOption[]>([]);
  const [loadingAds, setLoadingAds] = useState(false);
  const [showAdSelector, setShowAdSelector] = useState(false);

  const isKnownSource = SOURCE_OPTIONS.some((o) => o.value === source);
  const effectiveSource = isKnownSource ? source : "outro";

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
      setShowAdSelector(false);
    }
  }, [editOpen, lead]);

  const normalizeImgUrl = (url: string | null) => {
    if (!url) return "no-img";
    try { return new URL(url).origin + new URL(url).pathname; } catch { return url; }
  };

  const loadAds = async () => {
    setLoadingAds(true);
    const { data } = await supabase
      .from("crm_leads")
      .select("ad_id, imagem_origem, nome_anuncio, descricao_anuncio, link_anuncio")
      .not("ad_id", "is", null)
      .limit(1000);

    if (data) {
      const seen = new Map<string, AdOption>();
      for (const row of data) {
        const key = `${normalizeImgUrl(row.imagem_origem)}::${row.descricao_anuncio || row.ad_id}`;
        if (!seen.has(key)) {
          seen.set(key, {
            ad_id: row.ad_id!,
            imagem_origem: row.imagem_origem,
            nome_anuncio: row.nome_anuncio,
            descricao_anuncio: row.descricao_anuncio,
            link_anuncio: row.link_anuncio,
          });
        }
      }
      setAds(Array.from(seen.values()));
    }
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
    // Auto-set source
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
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    setSaving(true);
    const finalSource = effectiveSource === "outro" ? (customSource.trim() || "outro") : source;
    const updates = {
      name: name.trim(),
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
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
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
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Telefone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="5511999999999" />
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
    </>
  );
}
