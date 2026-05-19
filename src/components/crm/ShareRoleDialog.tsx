import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type OwnerRole = "gerente" | "crc" | "posvenda" | "superadmin" | null;

export const ROLE_LABEL: Record<string, string> = {
  gerente: "Gerente", crc: "CRC", posvenda: "Pós-venda", superadmin: "Superadmin",
};
export const ROLE_BADGE_COLOR: Record<string, string> = {
  gerente: "bg-blue-900/30 text-blue-400",
  crc: "bg-purple-900/30 text-purple-400",
  posvenda: "bg-green-900/30 text-green-400",
  superadmin: "bg-red-900/30 text-red-400",
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

export function OwnerRoleBadge({ ownerRole }: { ownerRole: OwnerRole }) {
  if (!ownerRole) {
    return <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-secondary text-muted-foreground">Compartilhado</span>;
  }
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${ROLE_BADGE_COLOR[ownerRole] || "bg-secondary text-muted-foreground"}`}>
      {ROLE_LABEL[ownerRole]}
    </span>
  );
}

const SHAREABLE_ROLES: Array<Exclude<OwnerRole, null | "superadmin">> = ["crc", "posvenda", "gerente"];

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
    const { error } = await (supabase.from(table) as any)
      .update({ owner_role: newOwner, shared_roles: sharedRoles })
      .eq("id", rowId);
    setSaving(false);
    if (error) { toast.error("Erro ao atualizar compartilhamento"); return; }
    toast.success(roles.length === 0 ? `${itemLabel} compartilhado com todos` : `${itemLabel} visível para: ${roles.map(r => ROLE_LABEL[r]).join(", ")}`);
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Compartilhar com papéis</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          Selecione um ou mais papéis que poderão visualizar este {itemLabel.toLowerCase()}. Deixe tudo desmarcado para compartilhar com todos.
        </p>
        <div className="space-y-2 mt-2">
          <Label>Visível para</Label>
          <div className="space-y-2">
            {SHAREABLE_ROLES.map(role => (
              <label key={role} className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox checked={selected.has(role!)} onCheckedChange={() => toggle(role!)} />
                <span>{ROLE_LABEL[role!]}</span>
              </label>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground pt-1">
            Gerente e Superadmin sempre visualizam tudo.
          </p>
        </div>
        <div className="flex gap-2 justify-end mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
