// Trava de regressão (caso Gilma, 15/10/2026): toda edge function que manda
// algo a um paciente pela Meta (/messages, /calls, block_users) precisa
// resolver o destino por _shared/destinoWhatsapp.ts. O telefone do lead é
// salvo sem o 9 e, nos DDD 11 a 28, mandar esse número dá 131026.
import { readdirSync, readFileSync, existsSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const FUNCOES = path.resolve(__dirname, "../../supabase/functions");
const ENVIO_META = /\/messages`|\/messages"|\/calls`|\/block_users`/;
// _shared/digitando.ts responde a um wamid (message_id), não a um telefone.

describe("destino do WhatsApp", () => {
  it("toda função que envia ao paciente pela Meta usa destinoWhatsapp", () => {
    const semDestino: string[] = [];
    for (const nome of readdirSync(FUNCOES)) {
      const arquivo = path.join(FUNCOES, nome, "index.ts");
      if (nome.startsWith("_") || nome.startsWith("instagram") || !existsSync(arquivo)) continue;
      const codigo = readFileSync(arquivo, "utf8");
      const enviaMeta = codigo.includes("graph.facebook.com") || codigo.includes("BASE_GRAPH_META");
      if (enviaMeta && ENVIO_META.test(codigo) && !codigo.includes("_shared/destinoWhatsapp.ts")) {
        semDestino.push(nome);
      }
    }
    expect(semDestino).toEqual([]);
  });
});
