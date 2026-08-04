/** Validação estrutural de mídia antes de cachear no Storage.
 *  Complementa a checagem de Content-Length: essa pega conexão cortada,
 *  a estrutural pega fonte que declara e entrega o mesmo valor truncado. */

/** Um MP4 é uma sequência de átomos [4 bytes de tamanho][4 bytes de tipo][dados].
 *  Se a soma dos tamanhos não fecha exatamente com o arquivo, ele está cortado. */
export function mp4Completo(b: Uint8Array): { ok: boolean; motivo?: string } {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = 0;
  while (off + 8 <= b.length) {
    const size = dv.getUint32(off);
    const tipo = new TextDecoder().decode(b.slice(off + 4, off + 8));
    if (size === 0) return { ok: false, motivo: `átomo ${tipo} com tamanho zero` };
    if (off + size > b.length) {
      return { ok: false, motivo: `átomo ${tipo} precisa de ${off + size} bytes, arquivo tem ${b.length}` };
    }
    off += size;
  }
  return off === b.length ? { ok: true } : { ok: false, motivo: `sobram ${b.length - off} bytes soltos` };
}

/** JPEG íntegro começa com FFD8 e termina com FFD9. */
export function jpegCompleto(b: Uint8Array): boolean {
  if (b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return false;
  let fim = b.length - 1;
  while (fim > 1 && b[fim] === 0x00) fim--; // ignora padding no fim
  return b[fim - 1] === 0xFF && b[fim] === 0xD9;
}

/** Retorna motivo do problema, ou null se estiver íntegro (ou tipo não checado). */
export function motivoMidiaIncompleta(bytes: Uint8Array, mime: string): string | null {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("video/mp4")) {
    const v = mp4Completo(bytes);
    if (!v.ok) return `Vídeo incompleto (${v.motivo})`;
  } else if (m.startsWith("image/jpeg")) {
    if (!jpegCompleto(bytes)) return "Imagem JPEG incompleta (sem marcador de fim)";
  }
  return null;
}
