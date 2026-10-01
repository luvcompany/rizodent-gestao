import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// O v2 é white-label: o nome do cliente de origem (de onde o CRClin foi
// remixado) não pode aparecer no front — nem em placeholder, nem em texto de
// exemplo, nem em comentário. A limpeza da Fase 1 buscou só o nome completo e
// deixou passar a forma curta num placeholder dos modelos de WhatsApp
// (verificação F-SITE-2). Este teste pega as duas formas.
//
// Fora da varredura: types.ts (gerado pelo Supabase a partir do banco) e este
// próprio arquivo. O padrão é montado em pedaços para não casar consigo mesmo.
const PADRAO = new RegExp("\\bRi" + "zo(dent)?\\b", "i");

const RAIZ = resolve(process.cwd(), "src");
const IGNORAR = new Set([
  "integrations/supabase/types.ts",
  "test/semMarcaDeCliente.test.ts",
]);
const EXTENSOES_DE_TEXTO = /\.(ts|tsx|js|jsx|mjs|cjs|css|json|md|html|svg|txt)$/i;

function arquivos(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) out.push(...arquivos(caminho));
    else if (EXTENSOES_DE_TEXTO.test(nome)) out.push(caminho);
  }
  return out;
}

describe("sem marca do cliente de origem em src/", () => {
  const lista = arquivos(RAIZ).filter((c) => !IGNORAR.has(relative(RAIZ, c).split("\\").join("/")));

  it("a varredura achou os arquivos do front", () => {
    expect(lista.length).toBeGreaterThan(100);
  });

  it("nenhum arquivo cita o nome (curto ou completo)", () => {
    const achados: string[] = [];
    for (const caminho of lista) {
      readFileSync(caminho, "utf8").split("\n").forEach((linha, i) => {
        if (PADRAO.test(linha)) achados.push(`${relative(RAIZ, caminho)}:${i + 1}: ${linha.trim().slice(0, 120)}`);
      });
    }
    expect(achados).toEqual([]);
  });
});
