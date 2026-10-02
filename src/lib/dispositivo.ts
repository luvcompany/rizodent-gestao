/** Resume o user-agent em "Navegador no Sistema" (ex.: "Chrome no Windows"). */
export function resumoDoDispositivo(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").trim();
  if (!ua) return "—";

  let navegador: string | null = null;
  if (/Edg(A|iOS)?\//.test(ua)) navegador = "Edge";
  else if (/OPR\/|Opera/.test(ua)) navegador = "Opera";
  else if (/SamsungBrowser\//.test(ua)) navegador = "Samsung Internet";
  else if (/CriOS\//.test(ua)) navegador = "Chrome";
  else if (/FxiOS\/|Firefox\//.test(ua)) navegador = "Firefox";
  else if (/Chrome\//.test(ua)) navegador = "Chrome";
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) navegador = "Safari";

  let sistema: string | null = null;
  if (/Windows/.test(ua)) sistema = "Windows";
  else if (/Android/.test(ua)) sistema = "Android";
  else if (/iPhone|iPod/.test(ua)) sistema = "iPhone";
  else if (/iPad/.test(ua)) sistema = "iPad";
  else if (/Macintosh|Mac OS X/.test(ua)) sistema = "Mac";
  else if (/Linux|CrOS/.test(ua)) sistema = "Linux";

  if (!navegador) return "Dispositivo não identificado";
  return sistema ? `${navegador} no ${sistema}` : navegador;
}
