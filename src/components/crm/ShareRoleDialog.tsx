import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type OwnerRole = "gerente" | "crc" | "posvenda" | "recepcao" | "closer" | "sdr" | "superadmin" | null;

export const ROLE_LABEL: Record<string, string> = {
  gerente: "Gerente", crc: "CRC", posvenda: "Pós-venda", recepcao: "Recepção", closer: "Closer", sdr: "SDR", superadmin: "Superadmin",
};
export const ROLE_BADGE_COLOR: Record<string, string> = {
  gerente: "bg-info-soft text-info-soft-foreground",
  crc: "bg-purple-soft text-purple-soft-foreground",
  posvenda: "bg-success-soft text-success-soft-foreground",
  recepcao: "bg-warning-soft text-warning-soft-foreground",
  closer: "bg-orange-soft text-orange-soft-foreground",
  sdr: "bg-teal-soft text-teal-soft-foreground",
  superadmin: "bg-destructive-soft text-destructive-soft-foreground",
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  table: "bots" | "crm_broadcasts" | "crm_quick_replies" | "crm_whatsapp_templates";
  rowId: string | null;
  currentOwnerRole: OwnerRole;
  currentSharedRoles?: string[] | null;
  itemLabel?: string;
  onSaved?: () => void;
};

/**
 * Rótulo do selo de visibilidade. O "mundo" crc é o da central: CRC e SDRs
 * trabalham com os mesmos bots/modelos/respostas (o que a SDR cria nasce com
 * owner_role 'crc' — ver ProtectedRoute). "CRC" sozinho fazia a SDR achar que
 * a resposta dela era da dona da clínica (SDR-22).
 */
const ROTULO_DO_SELO: Record<string, string> = { ...ROLE_LABEL, crc: "Central (CRC e SDRs)" };

export function OwnerRoleBadge({ ownerRole }: { ownerRole: OwnerRole }) {
  if (!ownerRole) {
    return <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-secondary text-muted-foreground">Compartilhado</span>;
  }
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${ROLE_BADGE_COLOR[ownerRole] || "bg-secondary text-muted-foreground"}`}>
      {ROTULO_DO_SELO[ownerRole] ?? ownerRole}
    </span>
  );
}

const SHAREABLE_ROLES: Array<Exclude<OwnerRole, null | "superadmin">> = ["crc", "posvenda", "gerente", "recepcao", "closer", "sdr"];

export default function ShareRoleDialog({ open, onOpenChange, table, rowId, currentOwnerRole, currentSharedRoles, itemLabel = "item", onSaved }: Props) {
  const initialSelected = (): Set<string> => {
    const s = new Set<string>();
    if (currentOwnerRole) s.add(currentOwnerRole);
    (currentSharedRoles || []).forEach(r => s.add(r));
    return s;
  };
  const [selected, setSelected] = useState<Set<string>>(initialSelected());
  const [saving, setSaving] = useState(false);

  useEffect(() => { setSelected(initialSelected()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [currentOwnerRole, rowId, JSON.stringify(currentSharedRoles)]);

  const toggle = (role: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role); else next.add(role);
      return next;
    });
  };

  const save = async () => {
    if (!rowId) return;
    setSaving(true);
    const roles = Array.from(selected);
    // owner_role: keep current if still selected, otherwise pick first selected, otherwise null (all)
    let newOwner: string | null = null;
    if (roles.length === 0) {
      newOwner = null;
    } else if (currentOwnerRole && roles.includes(currentOwnerRole)) {
      newOwner = currentOwnerRole;
    } else {
      newOwner = roles[0];
    }
    const sharedRoles = roles.filter(r => r !== newOwner);
    if (table === "crm_whatsapp_templates") {
      const { error } = await supabase.rpc("update_whatsapp_template_sharing" as any, {
        _template_id: rowId,
        _owner_role: newOwner,
        _shared_roles: sharedRoles,
      });
      setSaving(false);
      if (error) {
        console.error("[ShareRoleDialog] update failed", error);
        toast.error(`Erro ao atualizar compartilhamento: ${error.message || error.code || "desconhecido"}`);
        return;
      }
    } else {
      // O `.select()` confere o que gravou: quando a regra do banco recusa o
      // UPDATE (ex.: bot de outro papel), não vem erro — vem sucesso com zero linhas.
      const { data, error } = await (supabase.from(table) as any)
        .update({ owner_role: newOwner, shared_roles: sharedRoles })
        .eq("id", rowId)
        .select("id");
      setSaving(false);
      if (error) {
        console.error("[ShareRoleDialog] update failed", error);
        toast.error(`Erro ao atualizar compartilhamento: ${error.message || error.code || "desconhecido"}`);
        return;
      }
      if (!data || data.length === 0) {
        toast.error("Seu perfil não tem permissão para alterar o compartilhamento deste item.");
        return;
      }
    }
    toast.success(roles.length === 0 ? `${itemLabel} compartilhado com todos` : `${itemLabel} visível para: ${roles.map(r => ROLE_LABEL[r]).join(", ")}`);
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm overflow-hidden rounded-2xl p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-4"><DialogTitle>Compartilhar com papéis</DialogTitle></DialogHeader>
        <div className="px-5 pb-5">
        <p className="text-xs text-muted-foreground -mt-2">
          Selecione um ou mais papéis que poderão visualizar este {itemLabel.toLowerCase()}. Deixe tudo desmarcado para compartilhar com todos.
        </p>
        <div className="space-y-2 mt-2">
          <Label>Visível para</Label>
          <div className="space-y-2">
            {SHAREABLE_ROLES.map(role => (
               <label key={role} className="flex cursor-pointer items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5 text-sm transition-colors hover:bg-surface-sunken">
                <Checkbox checked={selected.has(role!)} onCheckedChange={() => toggle(role!)} />
                <span>{ROLE_LABEL[role!]}</span>
              </label>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground pt-1">
            Gerente e Superadmin sempre visualizam tudo.
          </p>
        </div>
         <div className="mt-4 flex justify-end gap-2 border-t border-border/60 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
         </div></div>
      </DialogContent>
    </Dialog>
  );
}
