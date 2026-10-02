/**
 * Figurinha e imagem WebP no compositor do chat — CONV-20.
 *
 * Antes QUALQUER .webp com menos de 512 KB, escolhido até pelo menu "Imagem",
 * ia como figurinha: a Meta recusava (figurinha é WebP 512×512 e sem
 * legenda) e o texto digitado junto se perdia. WebP maior ia como imagem
 * image/webp, formato que a Cloud API também não aceita como imagem (só JPEG
 * e PNG).
 *
 * Agora quem decide é o item do menu:
 *  - "Figurinha (WebP)": só passa WebP de 512×512 com até 100 KB (estática)
 *    ou 500 KB (animada) — os limites do WhatsApp;
 *  - "Imagem": WebP é convertido para JPEG no navegador e vai como imagem,
 *    com a legenda.
 */

export const LIMITE_FIGURINHA_ESTATICA = 100 * 1024;
export const LIMITE_FIGURINHA_ANIMADA = 500 * 1024;
export const LADO_DA_FIGURINHA = 512;

const texto = (bytes: Uint8Array, inicio: number, tamanho: number) =>
  String.fromCharCode(...Array.from(bytes.slice(inicio, inicio + tamanho)));

/** Primeiros bytes do arquivo (Blob.arrayBuffer, com reserva para ambientes sem ele). */
async function lerInicio(arquivo: Blob, tamanho: number): Promise<Uint8Array> {
  const pedaco = arquivo.slice(0, tamanho);
  if (typeof pedaco.arrayBuffer === "function") return new Uint8Array(await pedaco.arrayBuffer());
  return await new Promise<Uint8Array>((ok, falha) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(new Uint8Array(leitor.result as ArrayBuffer));
    leitor.onerror = () => falha(leitor.error);
    leitor.readAsArrayBuffer(pedaco);
  });
}

/** É WebP pelo cabeçalho ("RIFF....WEBP"), não pelo nome? */
export async function ehWebp(arquivo: Blob): Promise<boolean> {
  const b = await lerInicio(arquivo, 12);
  return b.length >= 12 && texto(b, 0, 4) === "RIFF" && texto(b, 8, 4) === "WEBP";
}

/** WebP animado: bloco VP8X com o bit de animação ligado. */
export async function webpAnimado(arquivo: Blob): Promise<boolean> {
  const b = await lerInicio(arquivo, 32);
  if (b.length < 21 || texto(b, 0, 4) !== "RIFF" || texto(b, 8, 4) !== "WEBP") return false;
  return texto(b, 12, 4) === "VP8X" && (b[20] & 0x02) !== 0;
}

async function dimensoes(arquivo: Blob): Promise<{ largura: number; altura: number } | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bmp = await createImageBitmap(arquivo);
    const r = { largura: bmp.width, altura: bmp.height };
    bmp.close?.();
    return r;
  } catch {
    return null;
  }
}

/**
 * Por que o arquivo NÃO pode ir como figurinha (null = pode). Frases em PT-BR
 * para o toast.
 */
export async function motivoFigurinhaInvalida(arquivo: File): Promise<string | null> {
  if (!(await ehWebp(arquivo))) return "A figurinha precisa ser um arquivo WebP.";
  const animada = await webpAnimado(arquivo);
  const limite = animada ? LIMITE_FIGURINHA_ANIMADA : LIMITE_FIGURINHA_ESTATICA;
  if (arquivo.size > limite) {
    return `Figurinha ${animada ? "animada" : "estática"} com ${Math.ceil(arquivo.size / 1024)} KB: o WhatsApp aceita até ${limite / 1024} KB.`;
  }
  const d = await dimensoes(arquivo);
  if (!d) return "Não foi possível ler a figurinha. Confira se o arquivo WebP está inteiro.";
  if (d.largura !== LADO_DA_FIGURINHA || d.altura !== LADO_DA_FIGURINHA) {
    return `A figurinha precisa ter 512×512 pixels (esta tem ${d.largura}×${d.altura}). Para mandar como foto, use o item “Imagem”.`;
  }
  return null;
}

/** O arquivo é WebP (pelo tipo ou pela extensão)? */
export function pareceWebp(arquivo: File): boolean {
  return arquivo.type === "image/webp" || /\.webp$/i.test(arquivo.name);
}

/**
 * Converte WebP em JPEG no navegador (fundo branco no lugar da transparência).
 * Lança Error com frase em PT-BR se o navegador não conseguir.
 */
export async function webpParaJpeg(arquivo: File, qualidade = 0.9): Promise<File> {
  if (typeof createImageBitmap !== "function") throw new Error("Este navegador não converte imagens WebP.");
  const bmp = await createImageBitmap(arquivo);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bmp.close?.();
    throw new Error("Este navegador não converte imagens WebP.");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", qualidade));
  if (!blob) throw new Error("Não foi possível converter a imagem WebP.");
  const nome = `${arquivo.name.replace(/\.webp$/i, "") || "imagem"}.jpg`;
  return new File([blob], nome, { type: "image/jpeg" });
}
