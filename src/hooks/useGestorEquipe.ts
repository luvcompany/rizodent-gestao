import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * "Sou gestor(a) da equipe?" — pergunta ao banco (RPC `is_gestor_equipe`:
 * superadmin OU auth.uid() = crm_rodizio_config.gestor_user_id do tenant atual).
 * NENHUM papel dá gestão sozinho — nem crc, nem gerente: o usuário do Meta App
 * Review também é crc e não pode ganhar poder de gestão, e a mesma função é a
 * porta de admin-manage-user (criar conta, redefinir senha), que nenhum papel
 * existente ganha de brinde. Gestor é NOMEADO pelo superadmin, um a um. Por isso
 * a decisão vem do servidor, e as RPCs da aba Equipe repetem a checagem por
 * dentro.
 *
 * Regras:
 *  - uma chamada por usuário por sessão (cache em memória; a promessa é
 *    compartilhada entre CrmLayout e a página, então não há chamada dupla);
 *  - "false" de verdade só vem do banco (`data === false`) ou da RPC ausente
 *    (PGRST202 — banco ainda sem a Fase 1): aí o item some e a rota fecha;
 *  - ERRO (rede, 5xx) NÃO é "não é gestor": `resolved` fica false, `erro`
 *    fica true e o último valor conhecido é mantido. Quem consome mostra
 *    "tentar de novo" em vez de expulsar — mesma classe da "corrida do papel
 *    no boot": nunca decidir por negação sobre um estado de erro;
 *  - nunca decide por negação com o papel ainda nulo: enquanto `resolved` é
 *    false, quem consome deve mostrar "carregando", não expulsar.
 */

// Papéis que a aba Equipe nunca alcança (rota fora da allowlist deles) —
// dispensa a chamada.
const NUNCA_GESTOR = new Set(["sdr", "recepcao", "closer"]);

type Resultado = { isGestor: boolean; erro: boolean };

const cache = new Map<string, Promise<Resultado>>();

/** RPC não existe no banco (Fase 1 ainda não publicada) = "false" definitivo. */
const rpcAusente = (e: unknown): boolean => {
  const err = (e && typeof e === "object" ? e : {}) as { code?: string; message?: string };
  return err.code === "PGRST202" || /could not find the function/i.test(String(err.message ?? ""));
};

export function consultarGestorEquipe(userId: string): Promise<Resultado> {
  let p = cache.get(userId);
  if (!p) {
    // RPC ainda não está em types.ts (gerado pelo Lovable) — padrão do projeto.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p = (supabase as any)
      .rpc("is_gestor_equipe")
      .then(({ data, error }: { data: unknown; error: unknown }): Resultado => {
        if (error) {
          if (rpcAusente(error)) return { isGestor: false, erro: false };
          // Sem cache em erro: uma falha de rede não pode virar "não é gestor"
          // pelo resto da sessão.
          cache.delete(userId);
          return { isGestor: false, erro: true };
        }
        return { isGestor: data === true, erro: false };
      })
      .catch((): Resultado => {
        cache.delete(userId);
        return { isGestor: false, erro: true };
      });
    cache.set(userId, p);
  }
  return p;
}

type Estado = { userId: string | null; isGestor: boolean; resolved: boolean; erro: boolean };

export function useGestorEquipe(): { isGestor: boolean; resolved: boolean; erro: boolean; tentarDeNovo: () => void } {
  const { user, userRole, roleResolved } = useAuth();
  const [state, setState] = useState<Estado>({ userId: null, isGestor: false, resolved: false, erro: false });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const uid = user?.id ?? null;
    if (!uid || !roleResolved) {
      setState({ userId: uid, isGestor: false, resolved: false, erro: false });
      return;
    }
    if (userRole && NUNCA_GESTOR.has(userRole)) {
      setState({ userId: uid, isGestor: false, resolved: true, erro: false });
      return;
    }
    let cancelled = false;
    consultarGestorEquipe(uid).then((r) => {
      if (cancelled) return;
      if (r.erro) {
        // Mantém o último valor conhecido DESTE usuário (o item do menu não
        // pisca) e sinaliza o erro; resolved=false para a página não fechar.
        setState((s) => ({ userId: uid, isGestor: s.userId === uid ? s.isGestor : false, resolved: false, erro: true }));
      } else {
        setState({ userId: uid, isGestor: r.isGestor, resolved: true, erro: false });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id, userRole, roleResolved, tentativa]);

  // O cache já foi apagado no erro; basta rodar o efeito de novo.
  const tentarDeNovo = useCallback(() => setTentativa((n) => n + 1), []);

  // Estado de OUTRO usuário (troca de sessão no mesmo navegador) não vale.
  const mesmoUsuario = state.userId === (user?.id ?? null);
  return {
    isGestor: mesmoUsuario && state.isGestor,
    resolved: mesmoUsuario && state.resolved,
    erro: mesmoUsuario && state.erro,
    tentarDeNovo,
  };
}
