import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { useBrand } from "@/contexts/BrandContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useTheme } from "@/hooks/useTheme";

// Identidade do operador nas páginas legais (as URLs do app Meta do sistema
// apontam para cá). Os dados vêm de system_settings (useBrand().system.legal);
// estes valores são o fallback, idêntico ao texto publicado em 28/09/2026, para
// a página nunca ficar sem dados enquanto carrega ou sem rede.
const FALLBACK = {
  sistema: "CRClin",
  operador: "Luv Company",
  cnpj: "68.064.280/0001-35",
  email: "contato@luvagency.com.br",
  endereco: null as string | null,
  atualizadoEmIso: "2026-09-28",
};

export const AVISO_RESPONSAVEL_NAO_CONFIGURADO = "Dados do responsável ainda não configurados.";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * "2026-09-28" (ou um timestamp ISO) → "28 de setembro de 2026".
 * Data sem hora é lida como data de calendário, sem fuso: new Date("2026-09-28")
 * seria meia-noite UTC e viraria dia 27 no Brasil.
 */
function formatarDataLegal(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor.trim());
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${dia} de ${MESES[mes - 1]} de ${ano}`;
}

function rotuloDoDocumento(doc: string): string {
  const digitos = doc.replace(/\D/g, "");
  return digitos.length === 11 ? "CPF" : "CNPJ";
}

export interface DadosLegais {
  /** Nome do sistema (system_settings.name). */
  sistema: string;
  /** Razão social / nome do operador; null quando o superadmin deixou vazio. */
  operador: string | null;
  /** Documento do operador (CNPJ, ou CPF); null quando não informado. */
  cnpj: string | null;
  /** E-mail do responsável pelo tratamento de dados; null quando vazio. */
  email: string | null;
  endereco: string | null;
  /** Data da versão vigente, já formatada em pt-BR ("28 de setembro de 2026"). */
  atualizadoEm: string;
  /** "Luv Company (CNPJ 68.064.280/0001-35)", ou só o operador sem documento. */
  operadorComDocumento: string | null;
  /** false quando operador ou e-mail vieram vazios da configuração. */
  configurado: boolean;
}

/**
 * Dados do responsável pelas páginas legais, lidos da marca do sistema.
 *
 * - Sem configuração lida (carregando sem cache, RPC fora do ar, payload antigo):
 *   usa o fallback completo, idêntico ao texto atual.
 * - Configuração lida com operador ou e-mail vazios: `configurado = false` e a
 *   tela mostra "Dados do responsável ainda não configurados.".
 */
export function useDadosLegais(): DadosLegais {
  const { system } = useBrand();
  const legal = system.legal;
  const sistema = system.name?.trim() || FALLBACK.sistema;

  const operador = legal ? legal.operator : FALLBACK.operador;
  const cnpj = legal ? legal.doc : FALLBACK.cnpj;
  const email = legal ? legal.email : FALLBACK.email;
  const endereco = legal ? legal.address : FALLBACK.endereco;
  const atualizadoEm =
    formatarDataLegal(legal?.updated_at) ?? (formatarDataLegal(FALLBACK.atualizadoEmIso) as string);

  const operadorComDocumento = operador
    ? cnpj
      ? `${operador} (${rotuloDoDocumento(cnpj)} ${cnpj})`
      : operador
    : null;

  return {
    sistema,
    operador,
    cnpj,
    email,
    endereco,
    atualizadoEm,
    operadorComDocumento,
    configurado: !!operador && !!email,
  };
}

/** Texto curto no lugar de um dado que falta, dentro de uma frase. */
function NaoConfigurado() {
  return <em className="not-italic text-muted-foreground">(não configurado)</em>;
}

/** Operador com documento, para usar dentro do texto jurídico. */
export function OperadorLegal() {
  const { operadorComDocumento } = useDadosLegais();
  return operadorComDocumento ? <>{operadorComDocumento}</> : <NaoConfigurado />;
}

/** E-mail do responsável como link mailto, para usar dentro do texto jurídico. */
export function EmailLegal() {
  const { email } = useDadosLegais();
  return email ? <a href={`mailto:${email}`}>{email}</a> : <NaoConfigurado />;
}

function MarcaDoSistema({ nome }: { nome: string }) {
  const { system } = useBrand();
  const escuro = useTheme().theme === "dark";
  const logo = (escuro ? system.logo_dark_url || system.logo_url : system.logo_url || system.logo_dark_url) || null;
  const [falhou, setFalhou] = useState(false);
  useEffect(() => setFalhou(false), [logo]);

  if (logo && !falhou) {
    return <img src={logo} alt={nome} onError={() => setFalhou(true)} className="h-8 max-w-[10rem] object-contain object-left" />;
  }
  return (
    <>
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
      >
        {nome.slice(0, 1).toUpperCase()}
      </span>
      <span className="truncate">{nome}</span>
    </>
  );
}

interface LegalLayoutProps {
  title: string;
  subtitle?: string;
  metaDescription?: string;
  children: ReactNode;
}

const LegalLayout = ({ title, subtitle, metaDescription, children }: LegalLayoutProps) => {
  const dados = useDadosLegais();
  usePageTitle(title);

  useEffect(() => {
    if (!metaDescription) return;
    let tag = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!tag) {
      tag = document.createElement("meta");
      tag.setAttribute("name", "description");
      document.head.appendChild(tag);
    }
    tag.setAttribute("content", metaDescription);
  }, [metaDescription]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-2 font-semibold text-foreground">
            <MarcaDoSistema nome={dados.sistema} />
          </Link>
          <Link
            to="/"
            className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground transition hover:text-primary"
          >
            <ArrowLeft size={14} aria-hidden /> Voltar ao início
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] px-4 py-12 sm:px-6 sm:py-16">
        <div className="mb-10 border-b pb-6">
          <h1 className="text-3xl font-bold text-primary sm:text-4xl">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
        </div>

        {!dados.configurado && (
          <div
            role="status"
            className="mb-8 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" aria-hidden />
            <p>{AVISO_RESPONSAVEL_NAO_CONFIGURADO}</p>
          </div>
        )}

        <article className="space-y-6 text-[15px] leading-relaxed text-foreground [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground [&_p]:text-muted-foreground [&_a]:break-words [&_a]:text-primary [&_a]:underline hover:[&_a]:opacity-80 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6 [&_ul]:text-muted-foreground">
          {children}
        </article>
      </main>

      <footer className="border-t bg-background">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-4 py-6 text-center text-xs text-muted-foreground sm:flex-row sm:px-6 sm:text-left">
          <div className="space-y-1">
            <p>
              © {new Date().getFullYear()} {dados.operadorComDocumento ?? dados.sistema}. Todos os direitos reservados.
            </p>
            {dados.endereco && <p>{dados.endereco}</p>}
          </div>
          <nav className="flex gap-4" aria-label="Páginas legais">
            <Link to="/privacidade" className="hover:text-primary">Privacidade</Link>
            <Link to="/termos" className="hover:text-primary">Termos</Link>
            <Link to="/exclusao-de-dados" className="hover:text-primary">Exclusão de Dados</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
};

export default LegalLayout;
