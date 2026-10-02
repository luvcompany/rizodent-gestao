import { useState, useEffect } from "react";
import AdThumb from "@/components/chat/AdThumb";
import { ORIGENS_LEAD, ORIGENS_LEAD_INSTAGRAM, origemLeadCanonica } from "@/lib/origensLead";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { X, Plus, Link2, Unlink, Video, Megaphone, Tag } from "lucide-react";
import { mergeAdCandidates, type AdOption } from "@/lib/adCreativeOptions";

type Props = {
  leadId: string;
  tags: string[];
  source: string | null;
  adId?: string | null;
  imagemOrigem?: string | null;
  nomeAnuncio?: string | null;
  descricaoAnuncio?: string | null;
  linkAnuncio?: string | null;
  adAccountId?: string | null;
  adAccountName?: string | null;
  pipelineId?: string | null;
  isInstagram?: boolean;
  onUpdated: (updates: Record<string, any>) => void;
};

const SOURCE_OPTIONS_DEFAULT = [
  { value: "anuncio", label: "Anúncio" },
  ...ORIGENS_LEAD.filter((o) => !["facebook_ad", "instagram_ad"].includes(o.valor)).map((o) => ({ value: o.valor, label: o.rotulo })),
];

const SOURCE_OPTIONS_INSTAGRAM = ORIGENS_LEAD_INSTAGRAM.map((o) => ({ value: o.valor, label: o.rotulo }));

const AD_SOURCE_VALUES = ["facebook_ad", "instagram_ad", "anuncio"];
const ehOrigemAnuncio = (s: string | null | undefined) => AD_SOURCE_VALUES.includes(origemLeadCanonica(s) || "");

function sourceToDropdown(source: string | null, options: { value: string; label: string }[]): string {
  if (!source) return "";
  if (ehOrigemAnuncio(source)) return "anuncio";
  const c = origemLeadCanonica(source);
  const match = options.find((o) => o.value === c);
  if (match) return match.value;
  // If "outro" is in options, fall back to it; otherwise empty
  return options.some((o) => o.value === "outro") ? "outro" : "";
}

export default function InlineTagsEditor({
  leadId, tags, source, adId, imagemOrigem, nomeAnuncio, descricaoAnuncio, linkAnuncio, adAccountId, adAccountName, pipelineId, isInstagram, onUpdated,
}: Props) {
  const isInstagramLead = !!isInstagram;
  const SOURCE_OPTIONS = isInstagramLead ? SOURCE_OPTIONS_INSTAGRAM : SOURCE_OPTIONS_DEFAULT;
  const [newTag, setNewTag] = useState("");
  const [customSource, setCustomSource] = useState("");
  const dropdownValue = sourceToDropdown(source, SOURCE_OPTIONS);
  const showCustom = dropdownValue === "outro" && !SOURCE_OPTIONS.slice(0, -1).some((o) => o.value === origemLeadCanonica(source));

  // Ad selector state
  const [ads, setAds] = useState<AdOption[]>([]);
  const [loadingAds, setLoadingAds] = useState(false);
  const [showAdSelector, setShowAdSelector] = useState(false);

  useEffect(() => {
    if (showCustom && source) {
      setCustomSource(ehOrigemAnuncio(source) ? "" : source);
    }
  }, [source]);

  const save = async (updates: Record<string, any>) => {
    // O `.select()` confere que a linha gravou: RLS barrada devolve sucesso
    // com zero linhas e a tag/origem apareceria na tela sem existir no banco.
    const { data, error } = await supabase
      .from("crm_leads")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", leadId)
      .select("id");
    if (error) { toast.error("Erro ao salvar: " + error.message); return; }
    if (!data || data.length === 0) {
      toast.error("Seu perfil não tem permissão para editar este lead.");
      return;
    }
    onUpdated(updates);
  };

  const addTag = () => {
    const tag = newTag.trim().toLowerCase();
    if (!tag || tags.includes(tag)) { setNewTag(""); return; }
    const next = [...tags, tag];
    setNewTag("");
    save({ tags: next });
  };

  const removeTag = (tag: string) => {
    save({ tags: tags.filter((t) => t !== tag) });
  };

  const handleSourceChange = (val: string) => {
    if (val === "anuncio") {
      // Keep existing ad source or default to facebook_ad
      const dbSource = ehOrigemAnuncio(source) ? source : "facebook_ad";
      save({ source: dbSource });
    } else if (val === "outro") {
      save({ source: "outro" });
    } else {
      // Clear ad data when switching away from anúncio
      if (ehOrigemAnuncio(source)) {
        save({
          source: val,
          ad_id: null,
          imagem_origem: null,
          nome_anuncio: null,
          descricao_anuncio: null,
          link_anuncio: null,
        });
      } else {
        save({ source: val });
      }
    }
    setShowAdSelector(false);
  };

  const handleCustomSourceSave = () => {
    if (customSource.trim()) {
      save({ source: customSource.trim() });
    }
  };

  const loadAds = async () => {
    setLoadingAds(true);
    const candidates: Omit<AdOption, "group_key">[] = [];

    const [{ data: leadsData }, { data: msgData }, { data: mappingData }] = await Promise.all([
      supabase
        .from("crm_leads")
        .select("ad_id, imagem_origem, nome_anuncio, descricao_anuncio, link_anuncio, ad_account_id, ad_account_name")
        .not("ad_id", "is", null)
        .limit(1000),
      supabase
        .from("messages")
        .select("ad_source_id, ad_image_url, ad_headline, ad_body, ad_source_url, ad_account_id, ad_account_name")
        .not("ad_source_id", "is", null)
        .limit(1000),
      supabase
        .from("ad_id_mapping")
        .select("ad_id, thumbnail_url, ad_name, ad_headline, ad_body, ad_account_id, ad_account_name")
        .order("updated_at", { ascending: false })
        .limit(1000),
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
    const src = ad.link_anuncio?.includes("instagram") ? "instagram_ad" : "facebook_ad";
    save({
      source: src,
      ad_id: ad.ad_id,
      imagem_origem: ad.imagem_origem,
      nome_anuncio: ad.nome_anuncio,
      descricao_anuncio: ad.descricao_anuncio,
      link_anuncio: ad.link_anuncio,
      ad_account_id: ad.ad_account_id,
      ad_account_name: ad.ad_account_name,
    });
    setShowAdSelector(false);
  };

  const handleUnlinkAd = () => {
    save({
      ad_id: null,
      imagem_origem: null,
      nome_anuncio: null,
      descricao_anuncio: null,
      link_anuncio: null,
      ad_account_id: null,
      ad_account_name: null,
    });
  };

  const isAdSource = dropdownValue === "anuncio";

  return (
    <div className="space-y-4 border-b border-border/60 px-5 py-5">
      {/* Source */}
      <div>
        <span className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
          <Megaphone size={14} strokeWidth={1.75} className="shrink-0 text-tertiary" />
          Origem
        </span>
        <Select value={dropdownValue || ""} onValueChange={handleSourceChange}>
          <SelectTrigger className="h-10 rounded-xl border-input bg-card text-sm">
            <SelectValue placeholder="Selecione a origem" />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {dropdownValue === "outro" && (
          <Input
            className="mt-2 h-10 rounded-xl border-input bg-card text-sm"
            value={customSource}
            onChange={(e) => setCustomSource(e.target.value)}
            onBlur={handleCustomSourceSave}
            onKeyDown={(e) => { if (e.key === "Enter") handleCustomSourceSave(); }}
            placeholder="Especifique a origem..."
          />
        )}
      </div>

      {/* Ad Linking (only when source is anúncio) */}
      {isAdSource && (
        <div>
          <span className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
            <Link2 size={14} strokeWidth={1.75} className="shrink-0 text-tertiary" />
            Anúncio vinculado
          </span>
          {adId ? (
            <div className="space-y-2 rounded-xl border border-border/60 bg-surface-sunken p-3">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => (showAdSelector ? setShowAdSelector(false) : handleOpenAdSelector())}
                  className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left"
                  title="Ver lista de anúncios"
                >
                  {imagemOrigem ? (
                    <AdThumb src={imagemOrigem} alt="Anúncio" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-card">
                      <Video size={18} strokeWidth={1.75} className="text-tertiary" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{nomeAnuncio || "Anúncio vinculado"}</p>
                    {adAccountName && (
                      <p className="mt-0.5 truncate text-xs font-medium text-info">Conta: {adAccountName}</p>
                    )}
                    {descricaoAnuncio && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{descricaoAnuncio}</p>
                    )}
                  </div>
                </button>
                <button
                  onClick={handleUnlinkAd}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-destructive transition-colors hover:bg-destructive-soft"
                  title="Desvincular anúncio"
                >
                  <Unlink size={15} strokeWidth={1.75} />
                </button>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => (showAdSelector ? setShowAdSelector(false) : handleOpenAdSelector())}
                className="h-9 w-full gap-1.5 rounded-xl bg-card text-[13px] font-medium"
              >
                <Link2 size={15} strokeWidth={1.75} /> {showAdSelector ? "Fechar lista" : "Ver lista de anúncios"}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={handleOpenAdSelector} className="h-10 w-full gap-1.5 rounded-xl text-[13px] font-medium">
              <Link2 size={15} strokeWidth={1.75} /> Selecionar anúncio
            </Button>
          )}

          {showAdSelector && (
            <div className="mt-2 max-h-60 overflow-y-auto rounded-xl border border-border/60 bg-card">
              {loadingAds ? (
                <p className="p-3 text-center text-xs text-tertiary">Carregando...</p>
              ) : ads.length === 0 ? (
                <p className="p-3 text-center text-xs text-tertiary">Nenhum anúncio encontrado</p>
              ) : (
                <div className="divide-y divide-border/60">
                  {ads.map((ad) => {
                    const atual = !!adId && ad.ad_id === adId;
                    return (
                      <button
                        key={ad.group_key}
                        type="button"
                        onClick={() => (atual ? setShowAdSelector(false) : handleSelectAd(ad))}
                        className={`flex w-full items-center gap-3 p-2.5 text-left transition-colors hover:bg-surface-sunken ${atual ? "bg-primary-soft" : ""}`}
                      >
                        {ad.imagem_origem ? (
                          <AdThumb src={ad.imagem_origem} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken">
                            <Video size={14} strokeWidth={1.75} className="text-tertiary" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-[13px] font-medium text-foreground">{ad.nome_anuncio || "Sem nome"}</p>
                          {ad.ad_account_name && (
                            <p className="truncate text-xs font-medium text-info">Conta: {ad.ad_account_name}</p>
                          )}
                          {ad.descricao_anuncio && (
                            <p className="line-clamp-1 text-xs text-muted-foreground">{ad.descricao_anuncio}</p>
                          )}
                        </div>
                        {atual && (
                          <span className="shrink-0 rounded-full bg-card px-2 py-0.5 text-[11px] font-medium text-primary">Atual</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tags */}
      <div>
        <span className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
          <Tag size={14} strokeWidth={1.75} className="shrink-0 text-tertiary" />
          Tags
        </span>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <Badge key={t} variant="secondary" className="h-7 max-w-full cursor-default gap-1 rounded-full border-transparent bg-muted px-3 text-xs font-medium text-foreground hover:bg-muted">
              #{t}
              <button onClick={() => removeTag(t)} className="-mr-1 grid h-5 w-5 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive-soft hover:text-destructive">
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
            className="h-10 flex-1 rounded-xl border-input bg-card text-sm"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
          />
          <button onClick={addTag} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground">
            <Plus size={16} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}
