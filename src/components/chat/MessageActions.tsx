import { useState } from "react";
import { SmilePlus, Reply, Forward, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Message = {
  id: string;
  content: string | null;
  type: string;
  direction: string;
};

type Props = {
  message: Message;
  onReply: (message: Message) => void;
  onForward: (message: Message) => void;
  onReact: (message: Message, emoji: string) => void;
  direction: string;
};

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "👏"];

export default function MessageActions({ message, onReply, onForward, onReact, direction }: Props) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-whatsapp-message", {
        body: { messageId: message.id },
      });
      if (error || (data as any)?.error) {
        toast.error((data as any)?.error || error?.message || "Falha ao apagar mensagem");
      } else {
        toast.success("Mensagem apagada");
      }
    } catch (e: any) {
      toast.error(e?.message || "Erro ao apagar mensagem");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div
      className={`absolute top-0 ${direction === "outbound" ? "-left-20" : "-right-20"} flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity`}
    >
      <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
        <PopoverTrigger asChild>
          <button className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors" title="Reagir">
            <SmilePlus size={14} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" side="top" align="center">
          <div className="flex gap-1">
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => {
                  onReact(message, emoji);
                  setEmojiOpen(false);
                }}
                className="text-lg hover:scale-125 transition-transform p-1"
              >
                {emoji}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <button
        onClick={() => onReply(message)}
        className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        title="Responder"
      >
        <Reply size={14} />
      </button>

      <button
        onClick={() => onForward(message)}
        className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        title="Encaminhar"
      >
        <Forward size={14} />
      </button>

      {direction === "outbound" && (
        <button
          onClick={() => setConfirmDelete(true)}
          className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
          title="Apagar mensagem"
        >
          <Trash2 size={14} />
        </button>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar mensagem?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja apagar essa mensagem? Ela será removida do WhatsApp do destinatário (se estiver dentro do prazo permitido pela Meta).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? "Apagando..." : "Apagar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
