import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface PreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  host: string;
}

// Cache em memória por sessão para evitar refetch ao trocar de conversa
const cache = new Map<string, PreviewData | null>();

export function LinkPreview({ url }: { url: string }) {
  const [data, setData] = useState<PreviewData | null | undefined>(() =>
    cache.has(url) ? cache.get(url) : undefined,
  );
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    if (cache.has(url)) {
      setData(cache.get(url)!);
      return;
    }
    let cancelled = false;
    supabase.functions
      .invoke("link-preview", { body: { url } })
      .then(({ data: res, error }) => {
        if (cancelled) return;
        if (error || !res || (res as any).error) {
          cache.set(url, null);
          setData(null);
          return;
        }
        cache.set(url, res as PreviewData);
        setData(res as PreviewData);
      });
    return () => { cancelled = true; };
  }, [url]);

  if (data === undefined) {
    // Loading skeleton discreto
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 block rounded-md border border-border/60 bg-muted/30 p-2 text-xs text-muted-foreground animate-pulse"
        onClick={(e) => e.stopPropagation()}
      >
        Carregando prévia...
      </a>
    );
  }
  if (!data || (!data.title && !data.description && !data.image)) {
    return null;
  }

  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 block overflow-hidden rounded-md border border-border/60 bg-muted/30 hover:bg-muted/50 transition-colors"
      onClick={(e) => e.stopPropagation()}
    >
      {data.image && !imgError && (
        <img
          src={data.image}
          alt=""
          className="w-full max-h-40 object-cover"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      )}
      <div className="p-2">
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          <ExternalLink size={10} />
          <span className="truncate">{data.siteName || data.host}</span>
        </div>
        {data.title && (
          <div className="text-xs font-semibold text-foreground line-clamp-2 mt-0.5">
            {data.title}
          </div>
        )}
        {data.description && (
          <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
            {data.description}
          </div>
        )}
      </div>
    </a>
  );
}
