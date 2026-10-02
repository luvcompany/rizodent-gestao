import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { recarregarUmaVez } from "@/lib/recarregarAposPublicacao";

/** Erro de pedaço de código que não baixou (versão nova publicada). */
const ERRO_DE_MODULO =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i;

type Props = { children: ReactNode };
type State = { erro: Error | null };

class ErrorBoundary extends Component<Props, State> {
  state: State = { erro: null };

  static getDerivedStateFromError(erro: Error): State {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", erro, info.componentStack);
    if (ERRO_DE_MODULO.test(erro?.message ?? "")) recarregarUmaVez();
  }

  render() {
    if (this.state.erro) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 bg-background p-6 text-center">
          <p className="text-lg font-semibold text-foreground">Algo deu errado ao abrir esta tela.</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Recarregue a página. Se o problema continuar, avise o suporte.
          </p>
          <Button onClick={() => window.location.reload()}>Recarregar</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
