import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";

// Quando o login expira ou é encerrado em outra aba, as funções do servidor
// respondem 401. Renova a sessão uma vez e repete a chamada antes de falhar.
// Sem sessão nenhuma, não chama a função (evita o 401).
const fns = supabase.functions as any;
if (!fns.__renovaSessao) {
  const original = fns.invoke.bind(fns);
  fns.invoke = async (nome: string, opts?: any) => {
    try {
      const temAuthManual = !!opts?.headers?.Authorization || !!opts?.headers?.authorization;
      if (!temAuthManual) {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          return { data: null, error: new Error("Sessão expirada — entre novamente."), response: undefined };
        }
      }
      const res = await original(nome, opts);
      const status = res?.error instanceof FunctionsHttpError ? res.error.context?.status : undefined;
      if (status !== 401 || temAuthManual) return res;
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) {
        console.warn(`[${nome}] sessão expirada — entre novamente.`);
        return res;
      }
      return await original(nome, opts);
    } catch (e) {
      return { data: null, error: e as Error, response: undefined };
    }
  };
  fns.__renovaSessao = true;
}
