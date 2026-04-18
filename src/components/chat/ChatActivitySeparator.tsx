import { ArrowRight, Edit, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Props = {
  content: string;
  timestamp: string;
  stageColor?: string | null;
  onDelete?: () => void;
};

export default function ChatActivitySeparator({ content, timestamp, stageColor, onDelete }: Props) {
  const isStageChange = content.includes("Etapa alterada");
  const isAppointment = /Agendamento|Reagendamento/i.test(content);
  const time = new Date(timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  // Extract destination stage name from "Etapa alterada: X → Y"
  const destStageName = isStageChange ? content.split("→").pop()?.trim() : null;

  const canDelete = !!onDelete && isAppointment;

  return (
    <div className="group/sep flex items-center gap-3 py-2 select-none">
      <div className="flex-1 h-px bg-border" />
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-secondary/80 px-3 py-1 rounded-full">
          {isStageChange ? <ArrowRight size={12} /> : <Edit size={12} />}
          <span>{content}</span>
          <span className="text-muted-foreground/60">· {time}</span>
          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  className="opacity-0 group-hover/sep:opacity-100 transition-opacity ml-1 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive"
                  title="Excluir confirmação"
                >
                  <Trash2 size={11} />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir confirmação?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta mensagem de sistema será removida do chat. Esta ação não pode ser desfeita.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Excluir
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        {isStageChange && stageColor && (
          <div className="flex items-center gap-1.5">
            <div
              className="h-2 w-10 rounded-full"
              style={{ backgroundColor: stageColor }}
            />
            {destStageName && (
              <span className="text-[10px] font-medium" style={{ color: stageColor }}>
                {destStageName}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}
