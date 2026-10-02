import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { extractStoragePath, getSignedMediaUrl } from "@/lib/mediaUtils";

/** <img> que assina URLs do bucket privado chat-media (miniaturas de anúncio). */
export default function AdThumb({ src, ...rest }: ImgHTMLAttributes<HTMLImageElement>) {
  const raw = typeof src === "string" ? src : "";
  const [url, setUrl] = useState<string | null>(raw && extractStoragePath(raw) ? null : raw || null);

  useEffect(() => {
    let ativo = true;
    if (raw && extractStoragePath(raw)) {
      setUrl(null);
      getSignedMediaUrl(raw).then((u) => { if (ativo) setUrl(u); });
    } else {
      setUrl(raw || null);
    }
    return () => { ativo = false; };
  }, [raw]);

  if (!url) return <div className={rest.className} aria-hidden />;
  return <img src={url} {...rest} />;
}
