import { ExternalLink } from "lucide-react";

type Props = {
  imagemOrigem?: string | null;
  tituloAnuncio?: string | null;
  descricaoAnuncio?: string | null;
  linkAnuncio?: string | null;
  adId?: string | null;
  nomeAnuncio?: string | null;
  source?: string | null;
  adAccountName?: string | null;
};

const fbIcon = (
  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-[#1877F2] flex-shrink-0">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
  </svg>
);

const igIcon = (
  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-[#E4405F] flex-shrink-0">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
  </svg>
);

function detectInstagram(source?: string | null, linkAnuncio?: string | null, adId?: string | null, imagemOrigem?: string | null): boolean {
  // Check source field first
  if (source && source.toLowerCase().includes("instagram")) return true;
  // Then check URLs/IDs
  return [linkAnuncio, adId, imagemOrigem].some(v => v && v.toLowerCase().includes("instagram"));
}

export default function LeadAdInfo({ imagemOrigem, tituloAnuncio, descricaoAnuncio, linkAnuncio, adId, nomeAnuncio, source, adAccountName }: Props) {
  const hasAdData = tituloAnuncio || descricaoAnuncio || imagemOrigem || nomeAnuncio || adId;
  if (!hasAdData) return null;

  const isInstagram = detectInstagram(source, linkAnuncio, adId, imagemOrigem);
  const icon = isInstagram ? igIcon : fbIcon;
  const label = isInstagram ? "Anúncio do Instagram" : "Anúncio do Facebook";

  return (
    <div className="p-4 border-b border-border">
      <h3 className="text-xs font-medium text-muted-foreground uppercase mb-2 flex items-center gap-1.5">
        {icon} Origem: {label}
      </h3>
      <div className="space-y-2">
        {imagemOrigem && (
          <div className="rounded-lg overflow-hidden border border-border">
            <img
              src={imagemOrigem}
              alt="Anúncio"
              className="w-full h-32 object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>
        )}
        {(tituloAnuncio || nomeAnuncio) && (
          <p className="text-sm font-semibold text-foreground">{tituloAnuncio || nomeAnuncio}</p>
        )}
        {adAccountName && (
          <p className="text-[11px] text-primary/70 font-medium">Conta: {adAccountName}</p>
        )}
        {descricaoAnuncio && (
          <p className="text-xs text-muted-foreground line-clamp-3">{descricaoAnuncio}</p>
        )}
        {linkAnuncio && (
          <a
            href={linkAnuncio}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink size={11} /> Ver anúncio
          </a>
        )}
        {adId && (
          <p className="text-[10px] text-muted-foreground">ID: {adId}</p>
        )}
      </div>
    </div>
  );
}
