import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Smile, Search, ImagePlus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { uploadAutomationMedia } from "@/components/automation/automationMediaUpload";
import { getSignedMediaUrl } from "@/lib/mediaUtils";

type StickerRow = {
  id: string;
  media_url: string;
  label: string | null;
};

type EmojiPickerButtonProps = {
  onEmojiSelect: (emoji: string) => void;
  onStickerSelect?: (mediaUrl: string) => void;
  stickersEnabled?: boolean;
  stickersDisabledReason?: string;
  disabled?: boolean;
};

const MAX_STICKER_BYTES = 500 * 1024;
// Largura padrão do picker do emoji-mart (perLine=9). A aba de figurinhas usa a
// mesma medida para o popover não mudar de largura ao trocar de aba.
const PANEL_W = "w-[352px]";

/** Props do <Picker> — idênticas às originais, antes da aba de figurinhas.
 *  theme="auto" segue o prefers-color-scheme do SO (não o tema do app). */
const PICKER_PROPS = {
  data,
  locale: "pt",
  theme: "auto" as const,
  previewPosition: "none" as const,
  skinTonePosition: "search" as const,
  set: "native" as const,
  maxFrequentRows: 2,
};

export default function EmojiPickerButton({
  onEmojiSelect,
  onStickerSelect,
  stickersEnabled = false,
  stickersDisabledReason,
  disabled,
}: EmojiPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"emojis" | "stickers">("emojis");

  const [items, setItems] = useState<StickerRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // chat-media é bucket PRIVADO: a media_url crua (/object/public/...) devolve 403
  // e a miniatura quebra. Guardamos aqui original -> URL assinada só para EXIBIR.
  const [signedMap, setSignedMap] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { tenant } = useTenant();
  const { user } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    const { data: rows, error } = await supabase
      .from("crm_stickers")
      .select("id, media_url, label")
      .order("created_at", { ascending: false });
    setLoading(false);
    setLoaded(true);
    if (error) {
      toast.error(`Erro ao carregar figurinhas: ${error.message}`);
      return;
    }
    setItems((rows as StickerRow[]) || []);
  }, []);

  // Lazy-load ao abrir a aba. Ao FECHAR o popover reseta `loaded` — a estrela que
  // salva a figurinha vive em outro componente (ChatMessageContent), então sem o
  // reset a galeria seguiria mostrando a lista antiga.
  useEffect(() => {
    if (open && tab === "stickers" && stickersEnabled && !loaded) {
      load();
    }
    if (!open) {
      setConfirmDeleteId(null);
      setQuery("");
      setLoaded(false);
    }
  }, [open, tab, stickersEnabled, loaded, load]);

  // Assina as URLs em lote. getSignedMediaUrl já tem cache (50min) e dedup de
  // requisições em voo, então reabrir a galeria não refaz trabalho.
  useEffect(() => {
    if (!items.length) return;
    let cancelled = false;
    (async () => {
      const pares = await Promise.all(
        items.map(async (s) => {
          try {
            return [s.media_url, await getSignedMediaUrl(s.media_url)] as const;
          } catch {
            return [s.media_url, ""] as const;
          }
        }),
      );
      if (cancelled) return;
      setSignedMap((prev) => {
        const next = { ...prev };
        for (const [orig, assinada] of pares) if (assinada) next[orig] = assinada;
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [items]);

  const handleDelete = useCallback(async (id: string) => {
    const { error } = await supabase.from("crm_stickers").delete().eq("id", id);
    if (error) {
      toast.error(`Erro ao remover: ${error.message}`);
      return;
    }
    setItems((prev) => prev.filter((s) => s.id !== id));
    toast.success("Figurinha removida");
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.type !== "image/webp") {
      toast.error("O WhatsApp só aceita figurinha em WebP 512×512.");
      return;
    }
    if (file.size > MAX_STICKER_BYTES) {
      toast.error("Figurinha deve ter no máximo 500 KB.");
      return;
    }
    if (!tenant?.id) {
      toast.error("Tenant não identificado");
      return;
    }
    setUploading(true);
    const uploaded = await uploadAutomationMedia(file, "stickers", {
      fileName: file.name,
      contentType: "image/webp",
    });
    if (!uploaded) {
      setUploading(false);
      return;
    }
    const label = file.name.replace(/\.[^.]+$/, "");
    const { data: inserted, error } = await supabase
      .from("crm_stickers")
      .insert({
        tenant_id: tenant.id,
        media_url: uploaded.url,
        origem: "propria",
        label,
        created_by: user?.id ?? null,
      })
      .select("id, media_url, label")
      .single();
    setUploading(false);
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        toast("Essa figurinha já está na galeria");
      } else {
        toast.error(`Erro ao salvar: ${error.message}`);
      }
      return;
    }
    if (inserted) setItems((prev) => [inserted as StickerRow, ...prev]);
    toast.success("Figurinha adicionada");
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((s) => (s.label || "").toLowerCase().includes(q));
  }, [items, query]);

  const stickersDisabled = Boolean(stickersDisabledReason);

  // A barra de abas precisa acompanhar o MESMO sinal do emoji-mart (que segue o
  // prefers-color-scheme do SO, não o tema do app). Por isso media query e não
  // `dark:` (classe do app) nem tokens do design system.
  const surface =
    "bg-white [@media(prefers-color-scheme:dark)]:bg-[#1d1d1d]";
  const divider =
    "border-black/10 [@media(prefers-color-scheme:dark)]:border-white/10";
  const mutedText =
    "text-neutral-500 [@media(prefers-color-scheme:dark)]:text-neutral-400";

  const stickersPanel = (
    <div className={`${PANEL_W} flex flex-col h-[380px] ${surface}`}>
      <div className={`p-2 border-b ${divider} shrink-0`}>
        <div className="relative">
          <Search
            size={14}
            className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${mutedText} pointer-events-none`}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar figurinha..."
            className={`w-full h-8 pl-8 pr-2 rounded-md text-sm outline-none border border-transparent
              bg-black/5 text-neutral-900 placeholder:text-neutral-500 focus:border-black/20
              [@media(prefers-color-scheme:dark)]:bg-white/5
              [@media(prefers-color-scheme:dark)]:text-neutral-100
              [@media(prefers-color-scheme:dark)]:placeholder:text-neutral-500
              [@media(prefers-color-scheme:dark)]:focus:border-white/20`}
          />
        </div>
      </div>

      {stickersDisabled && (
        <div className={`px-3 py-2 text-[11px] ${mutedText} border-b ${divider} shrink-0`}>
          {stickersDisabledReason}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/webp"
          className="hidden"
          onChange={handleFileChange}
        />
        {loading ? (
          <p className={`text-xs ${mutedText} py-6 text-center`}>Carregando...</p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {!query.trim() && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className={`aspect-square rounded-lg border ${divider} flex flex-col items-center justify-center gap-1 transition-colors disabled:opacity-50
                  bg-black/5 hover:bg-black/10
                  [@media(prefers-color-scheme:dark)]:bg-white/5
                  [@media(prefers-color-scheme:dark)]:hover:bg-white/10`}
                title="Enviar figurinha própria (WebP)"
              >
                <ImagePlus size={22} className={mutedText} />
                <span className={`text-[10px] font-medium ${mutedText}`}>
                  {uploading ? "..." : "Criar"}
                </span>
              </button>
            )}

            {filtered.map((s) => {
              const src = signedMap[s.media_url];
              return (
                <div key={s.id} className="relative group aspect-square">
                  <button
                    type="button"
                    disabled={stickersDisabled || !src}
                    onClick={() => {
                      if (stickersDisabled) return;
                      // Envia a URL ORIGINAL: o backend baixa do storage sozinho
                      // e a assinada expira em 1h.
                      onStickerSelect?.(s.media_url);
                      setOpen(false);
                    }}
                    className={`w-full h-full rounded-lg overflow-hidden flex items-center justify-center transition-colors disabled:cursor-not-allowed
                      bg-black/5 hover:bg-black/10
                      [@media(prefers-color-scheme:dark)]:bg-white/5
                      [@media(prefers-color-scheme:dark)]:hover:bg-white/10`}
                    title={stickersDisabled ? stickersDisabledReason : (s.label || "Enviar figurinha")}
                  >
                    {src ? (
                      // WebP animado anima sozinho no <img>. Nada de canvas,
                      // thumbnail ou transformação — congelaria a animação.
                      <img
                        src={src}
                        alt={s.label || "Figurinha"}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <span className="block w-full h-full animate-pulse bg-black/10 [@media(prefers-color-scheme:dark)]:bg-white/10" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirmDeleteId === s.id) {
                        handleDelete(s.id);
                        setConfirmDeleteId(null);
                      } else {
                        setConfirmDeleteId(s.id);
                        toast("Clique de novo no × para confirmar");
                      }
                    }}
                    className={`absolute -top-1 -right-1 p-0.5 rounded-full border ${divider} ${surface} shadow-sm transition-opacity ${
                      confirmDeleteId === s.id
                        ? "opacity-100 text-destructive"
                        : `opacity-0 group-hover:opacity-100 ${mutedText} hover:text-destructive`
                    }`}
                    title={confirmDeleteId === s.id ? "Clique de novo para confirmar" : "Remover da galeria"}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}

            {!loading && filtered.length === 0 && query.trim() && (
              <p className={`col-span-4 text-xs ${mutedText} py-6 text-center`}>
                Nenhuma figurinha com "{query}".
              </p>
            )}
            {!loading && loaded && items.length === 0 && !query.trim() && (
              <p className={`col-span-3 text-xs ${mutedText} py-2 leading-relaxed self-center`}>
                Nenhuma figurinha salva. Passe o mouse numa figurinha recebida na conversa
                e clique na estrela para salvar, ou use "Criar".
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="p-2 text-muted-foreground hover:text-primary transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          title={stickersEnabled ? "Emojis e figurinhas" : "Emojis"}
        >
          <Smile size={20} />
        </button>
      </PopoverTrigger>
      {/* className IDÊNTICO ao original — sem largura fixa, sem bg, sem overflow-hidden.
          É o que mantém a aba de Emojis exatamente como era antes das abas. */}
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-auto p-0 border-none shadow-lg"
      >
        {stickersEnabled ? (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "emojis" | "stickers")}>
            <TabsList
              className={`w-full grid grid-cols-2 rounded-none border-b ${divider} ${surface} p-0 h-9 shrink-0`}
            >
              <TabsTrigger
                value="emojis"
                className={`rounded-none h-full text-xs ${mutedText} data-[state=active]:shadow-none
                  data-[state=active]:bg-black/5 data-[state=active]:text-neutral-900
                  [@media(prefers-color-scheme:dark)]:data-[state=active]:bg-white/10
                  [@media(prefers-color-scheme:dark)]:data-[state=active]:text-white`}
              >
                Emojis
              </TabsTrigger>
              <TabsTrigger
                value="stickers"
                className={`rounded-none h-full text-xs ${mutedText} data-[state=active]:shadow-none
                  data-[state=active]:bg-black/5 data-[state=active]:text-neutral-900
                  [@media(prefers-color-scheme:dark)]:data-[state=active]:bg-white/10
                  [@media(prefers-color-scheme:dark)]:data-[state=active]:text-white`}
              >
                Figurinhas
              </TabsTrigger>
            </TabsList>

            {/* Sem classes de altura/largura/flex: o Picker manda no próprio tamanho. */}
            <TabsContent value="emojis" className="m-0">
              <Picker {...PICKER_PROPS} onEmojiSelect={(emoji: { native: string }) => onEmojiSelect(emoji.native)} />
            </TabsContent>

            <TabsContent value="stickers" className="m-0">
              {stickersPanel}
            </TabsContent>
          </Tabs>
        ) : (
          <Picker {...PICKER_PROPS} onEmojiSelect={(emoji: { native: string }) => onEmojiSelect(emoji.native)} />
        )}
      </PopoverContent>
    </Popover>
  );
}
