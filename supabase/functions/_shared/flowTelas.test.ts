import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dadosDaTelaInicial, lerTelasDoFlow, limparCacheDeFlows } from "./flowTelas.ts";

/**
 * O que estes testes protegem: o envio não pode inventar dados que a tela não
 * pede, nem quebrar quando a Meta não responde.
 */

const FLOW_JSON = {
  version: "7.1",
  screens: [
    { id: "CONFIRMACAO", title: "Sua consulta", data: { dias: { type: "array", __example__: [] } } },
    { id: "ESCOLHA", title: "Novo dia", data: {} },
  ],
};

function fetchFalso(respostas: Record<string, unknown>, contador?: { n: number }) {
  return ((u: string | URL | Request) => {
    const url = String(u);
    if (contador) contador.n++;
    if (url.includes("/assets")) {
      return Promise.resolve(new Response(JSON.stringify(respostas.assets ?? {}), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify(respostas.json ?? {}), { status: 200 }));
  }) as typeof fetch;
}

const ASSETS_OK = { data: [{ name: "flow.json", asset_type: "FLOW_JSON", download_url: "https://exemplo/flow.json" }] };

Deno.test("lê as telas e guarda em cache (2 chamadas só na primeira vez)", async () => {
  limparCacheDeFlows();
  const original = globalThis.fetch;
  const contador = { n: 0 };
  globalThis.fetch = fetchFalso({ assets: ASSETS_OK, json: FLOW_JSON }, contador);
  try {
    const telas = await lerTelasDoFlow("123", "tok");
    assertEquals(telas?.map((t) => t.id), ["CONFIRMACAO", "ESCOLHA"]);
    assertEquals(contador.n, 2);
    await lerTelasDoFlow("123", "tok");
    assertEquals(contador.n, 2); // veio do cache
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("tela de entrada: a do botão, e não sempre a primeira", async () => {
  limparCacheDeFlows();
  const original = globalThis.fetch;
  globalThis.fetch = fetchFalso({ assets: ASSETS_OK, json: FLOW_JSON });
  try {
    assertEquals(Object.keys((await dadosDaTelaInicial("9", "tok", "CONFIRMACAO")) ?? {}), ["dias"]);
    assertEquals(await dadosDaTelaInicial("9", "tok", "ESCOLHA"), {});
    assertEquals(Object.keys((await dadosDaTelaInicial("9", "tok", null)) ?? {}), ["dias"]);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("sem id, sem token, Meta fora do ar: devolve null em vez de lançar", async () => {
  limparCacheDeFlows();
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("caiu"))) as typeof fetch;
  try {
    assertEquals(await lerTelasDoFlow("", "tok"), null);
    assertEquals(await lerTelasDoFlow("1", ""), null);
    assertEquals(await lerTelasDoFlow("1", "tok"), null);
    assertEquals(await dadosDaTelaInicial("1", "tok"), null);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("flow sem asset JSON não vira tela fantasma", async () => {
  limparCacheDeFlows();
  const original = globalThis.fetch;
  globalThis.fetch = fetchFalso({ assets: { data: [] }, json: FLOW_JSON });
  try {
    assertEquals(await lerTelasDoFlow("7", "tok"), null);
  } finally {
    globalThis.fetch = original;
  }
});
