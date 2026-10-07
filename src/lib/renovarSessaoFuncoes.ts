import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";

// Quando o login expira ou é encerrado em outra aba, as funções do servidor
// respondem 401. Renova a sessão uma vez e repete a chamada antes de falhar.
const fns = supabase.functions as any;
if (!fns.__renovaSessao) {
  const original = fns.invoke.bind(fns);
  fns.invoke = async (nome: string, opts?: any) => {
    const res = await original(nome, opts);
    const status = res?.error instanceof FunctionsHttpError ? res.error.context?.status : undefined;
    if (status !== 401) return res;
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) {
      console.warn(`[${nome}] sessão expirada — entre novamente.`);
      return res;
    }
    return original(nome, opts);
  };
  fns.__renovaSessao = true;
}
