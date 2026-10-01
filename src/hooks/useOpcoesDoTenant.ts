import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Cidades e serviços oferecidos nos campos/filtros do lead, vindos do cadastro
// do PRÓPRIO tenant (clinicas.cidade ativas e tipos_procedimento ativos) — antes
// eram listas fixas das praças e serviços de uma clínica só.
//
// A leitura é por RPC (SECURITY DEFINER, só nomes) porque a SDR, o closer e a
// recepção não enxergam clinicas/tipos_procedimento pela RLS, e são eles que
// mais usam estes campos. Se a RPC ainda não existir (migration não aplicada),
// cai na leitura direta, que funciona para crc/gerente.

type Tipo = "cidades" | "servicos";

const cache = new Map<Tipo, Promise<string[]>>();
// Troca de sessão pode trocar de tenant: a lista guardada deixa de valer.
supabase.auth.onAuthStateChange((evento) => {
  if (evento === "SIGNED_IN" || evento === "SIGNED_OUT") cache.clear();
});

function unicosOrdenados(lista: unknown[]): string[] {
  const vistos = new Map<string, string>();
  for (const v of lista) {
    const t = String(v ?? "").trim().replace(/\s+/g, " ");
    if (!t) continue;
    const chave = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (!vistos.has(chave)) vistos.set(chave, t);
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

async function carregar(tipo: Tipo): Promise<string[]> {
  const rpc = tipo === "cidades" ? "cidades_do_tenant" : "servicos_do_tenant";
  // types.ts ainda não conhece as RPCs novas (é regenerado depois da migration).
  const { data, error } = await (supabase.rpc as unknown as (n: string) => Promise<{ data: unknown; error: unknown }>)(rpc);
  if (!error && Array.isArray(data)) {
    return unicosOrdenados(data.map((r) => (typeof r === "string" ? r : (r as Record<string, unknown>)?.[rpc])));
  }
  const res = tipo === "cidades"
    ? await supabase.from("clinicas").select("cidade").eq("ativa", true)
    : await supabase.from("tipos_procedimento").select("nome").eq("ativo", true);
  const linhas = (res.data || []) as Array<Record<string, unknown>>;
  return unicosOrdenados(linhas.map((l) => (tipo === "cidades" ? l.cidade : l.nome)));
}

function useOpcoes(tipo: Tipo): string[] {
  const [lista, setLista] = useState<string[]>([]);
  useEffect(() => {
    let vivo = true;
    let p = cache.get(tipo);
    if (!p) {
      p = carregar(tipo).catch(() => {
        cache.delete(tipo); // falha de rede não fica guardada
        return [];
      });
      cache.set(tipo, p);
    }
    p.then((l) => { if (vivo) setLista(l); });
    return () => { vivo = false; };
  }, [tipo]);
  return lista;
}

/** Cidades das clínicas ativas do tenant (sem repetição, em ordem alfabética). */
export function useCidadesDoTenant(): string[] {
  return useOpcoes("cidades");
}

/** Serviços (tipos_procedimento ativos) do tenant. */
export function useServicosDoTenant(): string[] {
  return useOpcoes("servicos");
}

/** Junta o valor atual à lista, para o select não "perder" um valor antigo. */
export function comValorAtual(lista: string[], atual: string | null | undefined): string[] {
  const v = (atual ?? "").trim();
  if (!v || lista.includes(v)) return lista;
  return [...lista, v];
}
