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
    <div className="group/sep flex select-none items-center gap-3 py-2.5">
      <div className="h-px flex-1 bg-border/70" />
      <div className="flex min-w-0 max-w-[85%] flex-col items-center gap-1.5">
        <div className="flex min-w-0 items-start gap-2 rounded-2xl border border-border/60 bg-card py-1.5 pl-1.5 pr-3 text-left text-xs font-medium leading-5 text-muted-foreground shadow-xs">
          <span className={isStageChange ? "grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-soft-fg" : "grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-tertiary"}>
            {isStageChange ? <ArrowRight size={12} strokeWidth={2} className="shrink-0" /> : <Edit size={12} strokeWidth={2} className="shrink-0" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="[overflow-wrap:anywhere]">{content}</span>
            <span className="ml-1.5 whitespace-nowrap font-normal tabular-nums text-tertiary">· {time}</span>
          </span>
          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  className="-mr-1 grid h-5 w-5 shrink-0 place-items-center rounded-md opacity-0 transition-opacity hover:bg-destructive-soft hover:text-destructive focus-visible:opacity-100 group-hover/sep:opacity-100"
                  title="Excluir confirmação"
                >
                  <Trash2 size={12} strokeWidth={1.75} />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="rounded-2xl">
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
              className="h-1.5 w-10 rounded-full"
              style={{ backgroundColor: stageColor }}
            />
            {destStageName && (
              <span className="text-[11px] font-semibold" style={{ color: stageColor }}>
                {destStageName}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="h-px flex-1 bg-border/70" />
    </div>
  );
}
