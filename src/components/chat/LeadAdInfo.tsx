import { ExternalLink, Megaphone } from "lucide-react";

type Props = {
  imagemOrigem?: string | null;
  tituloAnuncio?: string | null;
  descricaoAnuncio?: string | null;
  linkAnuncio?: string | null;
  adId?: string | null;
  nomeAnuncio?: string | null;
};

export default function LeadAdInfo({ imagemOrigem, tituloAnuncio, descricaoAnuncio, linkAnuncio, adId, nomeAnuncio }: Props) {
  const hasAdData = tituloAnuncio || descricaoAnuncio || imagemOrigem || nomeAnuncio || adId;
  if (!hasAdData) return null;

  return (
    <div className="p-4 border-b border-border">
      <h3 className="text-xs font-medium text-muted-foreground uppercase mb-2 flex items-center gap-1.5">
        <Megaphone size={12} /> Origem: Anúncio
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
