import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Erro de leitura canônica (RPC/consulta): sempre visível, nunca vira zero
 * silencioso. Sem `onRetry`, o cartão mostra só o motivo.
 */
export function RpcErrorCard({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-destructive/20 bg-destructive-soft p-4 flex flex-wrap items-center gap-3">
      <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
      <div className="flex-1 min-w-[200px]">
        <p className="text-sm font-semibold text-destructive-soft-foreground">{title}</p>
        <p className="text-xs text-destructive-soft-foreground/80 mt-0.5 break-words">{message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" className="h-8 rounded-lg border-destructive/30 bg-card text-[13px] font-semibold text-destructive-soft-foreground hover:bg-destructive-soft" onClick={onRetry}>Tentar novamente</Button>
      )}
    </div>
  );
}

export default RpcErrorCard;
