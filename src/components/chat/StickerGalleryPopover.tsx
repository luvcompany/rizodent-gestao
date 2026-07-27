import { useEffect, useState, useCallback } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Sticker, X } from "lucide-react";

type StickerRow = {
  id: string;
  media_url: string;
  label: string | null;
};

type Props = {
  disabled?: boolean;
  hidden?: boolean;
  disabledReason?: string;
  onPick: (sticker: StickerRow) => void;
};

export default function StickerGalleryPopover({ disabled, hidden, disabledReason, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<StickerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("crm_stickers")
      .select("id, media_url, label")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error(`Erro ao carregar figurinhas: ${error.message}`);
      return;
    }
    setItems((data as StickerRow[]) || []);
  }, []);

  useEffect(() => {
    if (open) {
      load();
      setConfirmDeleteId(null);
    }
  }, [open, load]);

  const handleDelete = useCallback(async (id: string) => {
    const { error } = await supabase.from("crm_stickers").delete().eq("id", id);
    if (error) {
      toast.error(`Erro ao remover: ${error.message}`);
      return;
    }
    setItems((prev) => prev.filter((s) => s.id !== id));
    toast.success("Figurinha removida");
  }, []);

  if (hidden) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="p-2 text-muted-foreground hover:text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={disabled ? (disabledReason || "Indisponível") : "Figurinhas salvas"}
          disabled={disabled}
        >
          <Sticker size={20} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8} className="w-72 p-2">
        <p className="text-xs font-medium text-muted-foreground px-1 mb-2">Minhas figurinhas</p>
        {loading ? (
          <p className="text-xs text-muted-foreground px-1 py-6 text-center">Carregando...</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1 py-6 text-center leading-relaxed">
            Nenhuma figurinha salva ainda. Passe o mouse numa figurinha recebida na conversa e clique na estrela para salvar.
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto">
            {items.map((s) => (
              <div key={s.id} className="relative group">
                <button
                  type="button"
                  onClick={() => {
                    onPick(s);
                    setOpen(false);
                  }}
                  className="w-16 h-16 flex items-center justify-center rounded border border-border bg-background hover:bg-muted transition-colors overflow-hidden"
                  title={s.label || "Enviar figurinha"}
                >
                  <img src={s.media_url} alt={s.label || "Figurinha"} className="w-16 h-16 object-contain" />
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
                  className={`absolute -top-1 -right-1 p-0.5 rounded-full border border-border bg-background shadow-sm transition-opacity ${
                    confirmDeleteId === s.id
                      ? "opacity-100 text-destructive"
                      : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  }`}
                  title={confirmDeleteId === s.id ? "Clique de novo para confirmar" : "Remover da galeria"}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
