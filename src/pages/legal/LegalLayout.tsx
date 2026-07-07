import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import crclinBrand from "@/assets/crclin-brand.png";

interface LegalLayoutProps {
  title: string;
  subtitle?: string;
  metaDescription?: string;
  children: ReactNode;
}

const LegalLayout = ({ title, subtitle, metaDescription, children }: LegalLayoutProps) => {
  useEffect(() => {
    document.title = `${title} — CRClin`;
    if (metaDescription) {
      let tag = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute("name", "description");
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", metaDescription);
    }
  }, [title, metaDescription]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <img src={crclinBrand} alt="CRClin" className="h-8 w-auto" />
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-slate-300 transition hover:text-cyan-300"
          >
            <ArrowLeft size={14} /> Voltar ao início
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] px-6 py-12 sm:py-16">
        <div className="mb-10 border-b border-slate-800 pb-6">
          <h1 className="bg-gradient-to-r from-cyan-300 via-blue-400 to-violet-400 bg-clip-text text-3xl font-bold text-transparent sm:text-4xl">
            {title}
          </h1>
          {subtitle && <p className="mt-2 text-sm text-slate-400">{subtitle}</p>}
        </div>

        <article className="space-y-6 text-[15px] leading-relaxed text-slate-200 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-100 [&_p]:text-slate-300 [&_a]:text-cyan-300 [&_a]:underline hover:[&_a]:text-cyan-200 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1 [&_ul]:text-slate-300">
          {children}
        </article>
      </main>

      <footer className="border-t border-slate-800 bg-slate-950">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-6 py-6 text-xs text-slate-400 sm:flex-row">
          <p>© {new Date().getFullYear()} CRClin. Todos os direitos reservados.</p>
          <div className="flex gap-4">
            <Link to="/privacidade" className="hover:text-cyan-300">Privacidade</Link>
            <Link to="/termos" className="hover:text-cyan-300">Termos</Link>
            <Link to="/exclusao-de-dados" className="hover:text-cyan-300">Exclusão de Dados</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LegalLayout;
