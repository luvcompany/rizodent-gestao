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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { tenant } = useTenant();
  const { user } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("crm_stickers")
      .select("id, media_url, label")
      .order("created_at", { ascending: false });
    setLoading(false);
    setLoaded(true);
    if (error) {
      toast.error(`Erro ao carregar figurinhas: ${error.message}`);
      return;
    }
    setItems((data as StickerRow[]) || []);
  }, []);

  // Lazy-load stickers on first open of the Stickers tab
  useEffect(() => {
    if (open && tab === "stickers" && stickersEnabled && !loaded) {
      load();
    }
    if (!open) {
      setConfirmDeleteId(null);
      setQuery("");
      // Reseta o cache ao fechar: a estrela que salva a figurinha fica em OUTRO
      // componente (ChatMessageContent), então sem isso a galeria continuaria
      // mostrando a lista antiga (bug: figurinha salva não aparecia).
      setLoaded(false);
    }
  }, [open, tab, stickersEnabled, loaded, load]);

  const handleDelete = useCallback(async (id: string) => {
    const { error } = await supabase.from("crm_stickers").delete().eq("id", id);
    if (error) {
      toast.error(`Erro ao remover: ${error.message}`);
      return;
    }
    setItems((prev) => prev.filter((s) => s.id !== id));
    toast.success("Figurinha removida");
  }, []);

  const handleCreateClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.type !== "image/webp") {
      toast.error("WhatsApp só aceita figurinha em WebP 512×512.");
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
    const { data, error } = await supabase
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
      if ((error as any).code === "23505") {
        toast("Essa figurinha já está na galeria");
      } else {
        toast.error(`Erro ao salvar: ${error.message}`);
      }
      return;
    }
    if (data) setItems((prev) => [data as StickerRow, ...prev]);
    toast.success("Figurinha adicionada");
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((s) => (s.label || "").toLowerCase().includes(q));
  }, [items, query]);

  const stickersDisabled = Boolean(stickersDisabledReason);

  const renderStickerGrid = () => (
    <div className="flex-1 overflow-y-auto p-2 bg-[#1d1d1d]">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/webp"
        className="hidden"
        onChange={handleFileChange}
      />
      {loading ? (
        <p className="text-xs text-neutral-400 py-6 text-center">Carregando...</p>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {!query.trim() && (
            <button
              type="button"
              onClick={handleCreateClick}
              disabled={uploading}
              className="aspect-square rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex flex-col items-center justify-center gap-1 transition-colors disabled:opacity-50"
              title="Enviar figurinha própria (WebP)"
            >
              <ImagePlus size={22} className="text-neutral-400" />
              <span className="text-[10px] font-medium text-neutral-400">
                {uploading ? "..." : "Criar"}
              </span>
            </button>
          )}
          {filtered.map((s) => (
            <div key={s.id} className="relative group aspect-square">
              <button
                type="button"
                disabled={stickersDisabled}
                onClick={() => {
                  if (stickersDisabled) return;
                  onStickerSelect?.(s.media_url);
                  setOpen(false);
                }}
                className="w-full h-full rounded-lg bg-white/5 hover:bg-white/10 transition-colors overflow-hidden flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-60"
                title={stickersDisabled ? stickersDisabledReason : (s.label || "Enviar figurinha")}
              >
                <img
                  src={s.media_url}
                  alt={s.label || "Figurinha"}
                  loading="lazy"
                  className="w-full h-full object-contain"
                />
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
                    toast("Clique de novo no × para confirmar remoção");
                  }
                }}
                className={`absolute -top-1 -right-1 p-0.5 rounded-full border border-white/10 bg-[#1d1d1d] shadow-sm transition-opacity ${
                  confirmDeleteId === s.id
                    ? "opacity-100 text-destructive"
                    : "opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-destructive"
                }`}
                title={confirmDeleteId === s.id ? "Clique de novo para confirmar" : "Remover da galeria"}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {!loading && filtered.length === 0 && query.trim() && (
            <p className="col-span-4 text-xs text-neutral-400 py-6 text-center">
              Nenhuma figurinha com "{query}".
            </p>
          )}
          {!loading && loaded && items.length === 0 && !query.trim() && (
            <p className="col-span-3 text-xs text-neutral-400 py-2 leading-relaxed self-center">
              Nenhuma figurinha salva. Passe o mouse numa figurinha recebida na conversa e clique na estrela para salvar, ou use "Criar" para enviar sua própria (WebP).
            </p>
          )}
        </div>
      )}
    </div>
  );


  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="p-2 text-muted-foreground hover:text-primary transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          title="Emojis e figurinhas"
        >
          <Smile size={20} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[360px] p-0 border-none shadow-lg overflow-hidden bg-[#1d1d1d]"
      >
        {stickersEnabled ? (
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "emojis" | "stickers")}
            className="flex flex-col"
          >
            <TabsList className="w-full grid grid-cols-2 rounded-none border-b border-white/10 bg-[#1d1d1d] p-0 h-10 shrink-0">
              <TabsTrigger
                value="emojis"
                className="rounded-none h-full text-sm text-neutral-400 hover:text-neutral-200 data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none"
              >
                Emojis
              </TabsTrigger>
              <TabsTrigger
                value="stickers"
                className="rounded-none h-full text-sm text-neutral-400 hover:text-neutral-200 data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none"
              >
                Figurinhas
              </TabsTrigger>
            </TabsList>

            <TabsContent value="emojis" className="m-0">
              <Picker
                data={data}
                onEmojiSelect={(emoji: any) => onEmojiSelect(emoji.native)}
                locale="pt"
                theme="dark"
                previewPosition="none"
                skinTonePosition="search"
                set="native"
                maxFrequentRows={2}
              />
            </TabsContent>

            <TabsContent
              value="stickers"
              className="m-0 flex flex-col h-[420px] overflow-hidden"
            >
              <div className="p-2 border-b border-white/10 bg-[#1d1d1d] shrink-0">
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
                  />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar figurinha..."
                    className="w-full h-8 pl-8 pr-2 rounded-md bg-white/5 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:ring-1 focus:ring-white/20 border border-transparent focus:border-white/20"
                  />
                </div>
              </div>
              {stickersDisabled && (
                <div className="px-3 py-2 text-[11px] text-neutral-400 border-b border-white/10 bg-white/5 shrink-0">
                  {stickersDisabledReason}
                </div>
              )}
              {renderStickerGrid()}
            </TabsContent>
          </Tabs>
        ) : (
          <Picker
            data={data}
            onEmojiSelect={(emoji: any) => onEmojiSelect(emoji.native)}
            locale="pt"
            theme="dark"
            previewPosition="none"
            skinTonePosition="search"
            set="native"
            maxFrequentRows={2}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
