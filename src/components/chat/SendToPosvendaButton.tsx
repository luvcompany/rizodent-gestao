import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { motivoDoServidor } from "@/lib/erroDeFuncao";

type Stage = { id: string; name: string; pipeline_id: string };

interface Props {
  leadId: string;
  stageId: string;
  assignedTo: string | null | undefined;
  stages: Stage[];
  onTransferred?: (payload: { assigned_to: string; pipeline_id?: string; stage_id?: string }) => void;
}

/**
 * Shown only when the lead is in a "Contratado" stage of a pipeline that is NOT
 * the Pós-venda pipeline AND the lead is not yet assigned to a posvenda user.
 * Clicking calls `transfer-lead` with the tenant's default posvenda user — the
 * function moves the lead to the Pós-venda pipeline + first stage automatically.
 */
export default function SendToPosvendaButton({
  leadId,
  stageId,
  assignedTo,
  stages,
  onTransferred,
}: Props) {
  const { userRole } = useAuth();
  const [posvendaUser, setPosvendaUser] = useState<{ id: string; nome: string } | null>(null);
  const [posvendaPipelineIds, setPosvendaPipelineIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Default posvenda user (first found in tenant)
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "posvenda")
        .limit(5);
      const ids = (roles || []).map((r: any) => r.user_id);
      let pickedUser: { id: string; nome: string } | null = null;
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, nome")
          .in("id", ids)
          .limit(1);
        if (profs && profs.length) pickedUser = profs[0] as any;
      }
      // Consulta acima volta VAZIA para quem não é crc/gerente: as únicas
      // policies de SELECT em user_roles são "Users can view own roles"
      // (auth.uid() = user_id) e "Tenant admins view roles in tenant". Para a
      // SDR isso significava `posvendaUser = null` e, logo abaixo,
      // `if (!posvendaUser) return null` — o botão não existia, e encaminhar o
      // lead fechado para a pós-venda é o ÚNICO caminho de saída do lead dela
      // (o transfer-lead abre essa exceção de propósito).
      // Cai então na RPC posvenda_padrao_do_tenant (SECURITY DEFINER; só id e
      // nome das pós-vendas ativas do tenant atual), mesmo molde de
      // closer_clinicas_do_tenant.
      // SÓ para a SDR: closer e recepção também voltam vazio da consulta acima
      // (a RLS de user_roles esconde as linhas das colegas) e HOJE não veem
      // este botão. Chamar a RPC para todo papel faria o botão APARECER para
      // eles — papel existente passando a poder mais, o que esta fase proíbe —
      // e ainda entregaria a eles quem é a pós-venda do cliente. A própria RPC
      // tem a mesma guarda no banco (migration 20260908150000, bloco 4.13).
      if (!pickedUser && userRole === "sdr") {
        try {
          // RPC da Fase 1 ainda não está em types.ts (gerado pelo Lovable).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: viaRpc } = await (supabase as any).rpc("posvenda_padrao_do_tenant");
          if (Array.isArray(viaRpc) && viaRpc.length) {
            pickedUser = { id: viaRpc[0].id, nome: viaRpc[0].nome };
          }
        } catch {
          /* RPC ausente (banco sem a Fase 1) → segue sem botão, como antes */
        }
      }
      // Pós-venda pipelines (for current tenant via RLS)
      const { data: pipelines } = await supabase
        .from("crm_pipelines")
        .select("id, allowed_roles")
        .contains("allowed_roles", ["posvenda"]);
      if (cancelled) return;
      setPosvendaUser(pickedUser);
      setPosvendaPipelineIds(new Set((pipelines || []).map((p: any) => p.id)));
    })();
    return () => { cancelled = true; };
    // userRole entra nas dependências porque o papel chega depois do primeiro
    // render (AuthContext resolve em outra rodada): sem isso o fallback da SDR
    // nunca rodaria e o botão sumiria justamente para quem ele existe.
  }, [userRole]);

  const currentStage = stages.find((s) => s.id === stageId);
  const isContractedStage = currentStage
    ? /contrat/i.test(currentStage.name) && !/n[ãa]o\s*contrat/i.test(currentStage.name)
    : false;
  const isAlreadyInPosvendaPipeline = currentStage
    ? posvendaPipelineIds.has(currentStage.pipeline_id)
    : false;
  const isAlreadyAssignedToPosvenda = !!(posvendaUser && assignedTo === posvendaUser.id);

  if (!posvendaUser) return null;
  if (!isContractedStage) return null;
  if (isAlreadyInPosvendaPipeline) return null;
  if (isAlreadyAssignedToPosvenda) return null;

  const send = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("transfer-lead", {
        body: { leadId, newUserId: posvendaUser.id },
      });
      if (error || (data as any)?.error) {
        toast.error(await motivoDoServidor(data, error, "Erro ao enviar para Pós-venda"));
        return;
      }
      toast.success(`Lead enviado para ${posvendaUser.nome} (Pós-venda)`);
      onTransferred?.({
        assigned_to: posvendaUser.id,
        // The edge function returns moved_pipeline/moved_stage names — pipeline_id will
        // be refreshed by the next fetch; here we trigger optimistic re-fetch upstream.
      });
    } catch {
      toast.error("Erro ao enviar para Pós-venda");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={send}
      disabled={loading}
      size="sm"
      className="mt-3 w-full bg-primary hover:bg-primary/90"
    >
      {loading ? <Loader2 size={14} className="mr-2 animate-spin" /> : <ArrowRightLeft size={14} className="mr-2" />}
      Enviar para Pós-venda ({posvendaUser.nome})
    </Button>
  );
}
