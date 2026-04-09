import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { X, Plus, Link2, Unlink, Video } from "lucide-react";

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
  onUpdated: (updates: Record<string, any>) => void;
};

const SOURCE_OPTIONS = [
  { value: "anúncio", label: "Anúncio" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "indicação", label: "Indicação" },
  { value: "orgânico", label: "Orgânico" },
  { value: "site", label: "Site" },
  { value: "ligação", label: "Ligação" },
  { value: "outro", label: "Outro" },
];

const AD_SOURCE_VALUES = ["facebook_ad", "instagram_ad", "anúncio"];

function sourceToDropdown(source: string | null): string {
  if (!source) return "";
  if (AD_SOURCE_VALUES.includes(source.toLowerCase())) return "anúncio";
  const match = SOURCE_OPTIONS.find((o) => o.value === source.toLowerCase());
  return match ? match.value : "outro";
}

export default function InlineTagsEditor({
  leadId, tags, source, adId, imagemOrigem, nomeAnuncio, descricaoAnuncio, linkAnuncio, adAccountId, adAccountName, onUpdated,
}: Props) {
  const [newTag, setNewTag] = useState("");
  const [customSource, setCustomSource] = useState("");
  const dropdownValue = sourceToDropdown(source);
  const showCustom = dropdownValue === "outro" && !SOURCE_OPTIONS.slice(0, -1).some((o) => o.value === source?.toLowerCase());

  // Ad selector state
  const [ads, setAds] = useState<AdOption[]>([]);
  const [loadingAds, setLoadingAds] = useState(false);
  const [showAdSelector, setShowAdSelector] = useState(false);

  useEffect(() => {
    if (showCustom && source) {
      setCustomSource(AD_SOURCE_VALUES.includes(source.toLowerCase()) ? "" : source);
    }
  }, [source]);

  const save = async (updates: Record<string, any>) => {
    const { error } = await supabase
      .from("crm_leads")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", leadId);
    if (error) { toast.error("Erro ao salvar"); return; }
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
    if (val === "anúncio") {
      // Keep existing ad source or default to facebook_ad
      const dbSource = AD_SOURCE_VALUES.includes(source?.toLowerCase() || "") ? source : "facebook_ad";
      save({ source: dbSource });
    } else if (val === "outro") {
      save({ source: "outro" });
    } else {
      // Clear ad data when switching away from anúncio
      if (AD_SOURCE_VALUES.includes(source?.toLowerCase() || "")) {
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

  const normalizeImgUrl = (url: string | null) => {
    if (!url) return "no-img";
    try { return new URL(url).origin + new URL(url).pathname; } catch { return url; }
  };

  const loadAds = async () => {
    setLoadingAds(true);
    const seen = new Map<string, AdOption>();

    // 1) From crm_leads
    const { data: leadsData } = await supabase
      .from("crm_leads")
      .select("ad_id, imagem_origem, nome_anuncio, descricao_anuncio, link_anuncio, ad_account_id, ad_account_name")
      .not("ad_id", "is", null)
      .limit(1000);

    if (leadsData) {
      for (const row of leadsData) {
        const key = `${normalizeImgUrl(row.imagem_origem)}::${row.descricao_anuncio || row.ad_id}::${row.ad_account_id || ""}`;
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

    // 2) From messages (captures ads not yet linked to leads)
    const { data: msgData } = await supabase
      .from("messages")
      .select("ad_source_id, ad_image_url, ad_headline, ad_body, ad_source_url, ad_account_id, ad_account_name")
      .not("ad_source_id", "is", null)
      .limit(1000);

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
    const src = ad.link_anuncio?.includes("instagram") ? "instagram_ad" : "facebook_ad";
    save({
      source: src,
      ad_id: ad.ad_id,
      imagem_origem: ad.imagem_origem,
      nome_anuncio: ad.nome_anuncio,
      descricao_anuncio: ad.descricao_anuncio,
      link_anuncio: ad.link_anuncio,
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
    });
  };

  const isAdSource = dropdownValue === "anúncio";

  return (
    <div className="p-4 border-b border-border space-y-3">
      {/* Source */}
      <div>
        <span className="text-xs text-muted-foreground block mb-1">Origem</span>
        <Select value={dropdownValue || ""} onValueChange={handleSourceChange}>
          <SelectTrigger className="h-8 text-sm">
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
            className="h-7 text-xs mt-1.5"
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
          <span className="text-xs text-muted-foreground block mb-1">Anúncio vinculado</span>
          {adId ? (
            <div className="border border-border rounded-md p-2 space-y-1">
              <div className="flex items-start gap-2">
                {imagemOrigem ? (
                  <img src={imagemOrigem} alt="Anúncio" className="w-14 h-14 rounded object-cover shrink-0" />
                ) : (
                  <div className="w-14 h-14 rounded bg-muted flex items-center justify-center shrink-0">
                    <Video size={18} className="text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{nomeAnuncio || "Anúncio vinculado"}</p>
                  {descricaoAnuncio && (
                    <p className="text-[10px] text-muted-foreground line-clamp-2">{descricaoAnuncio}</p>
                  )}
                </div>
                <button
                  onClick={handleUnlinkAd}
                  className="shrink-0 text-destructive hover:text-destructive/80 p-1"
                  title="Desvincular anúncio"
                >
                  <Unlink size={12} />
                </button>
              </div>
            </div>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={handleOpenAdSelector} className="w-full h-7 text-xs">
                <Link2 size={12} className="mr-1" /> Selecionar anúncio
              </Button>

              {showAdSelector && (
                <div className="mt-1.5 border border-border rounded-md max-h-48 overflow-y-auto">
                  {loadingAds ? (
                    <p className="text-xs text-muted-foreground p-3 text-center">Carregando...</p>
                  ) : ads.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-3 text-center">Nenhum anúncio encontrado</p>
                  ) : (
                    <div className="divide-y divide-border">
                      {ads.map((ad) => (
                        <button
                          key={ad.ad_id}
                          type="button"
                          onClick={() => handleSelectAd(ad)}
                          className="w-full flex items-center gap-2 p-2 hover:bg-accent text-left transition-colors"
                        >
                          {ad.imagem_origem ? (
                            <img src={ad.imagem_origem} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
                          ) : (
                            <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0">
                              <Video size={14} className="text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{ad.nome_anuncio || "Sem nome"}</p>
                            {ad.descricao_anuncio && (
                              <p className="text-[10px] text-muted-foreground line-clamp-1">{ad.descricao_anuncio}</p>
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
      )}

      {/* Tags */}
      <div>
        <span className="text-xs text-muted-foreground block mb-1">Tags</span>
        <div className="flex flex-wrap gap-1 mb-1.5">
          {tags.map((t) => (
            <Badge key={t} variant="secondary" className="text-xs gap-1 cursor-default">
              #{t}
              <button onClick={() => removeTag(t)} className="hover:text-destructive ml-0.5">
                <X size={10} />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex gap-1">
          <Input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="Nova tag..."
            className="h-7 text-xs flex-1"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
          />
          <button onClick={addTag} className="h-7 w-7 flex items-center justify-center rounded-md border border-border hover:bg-secondary transition-colors">
            <Plus size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
