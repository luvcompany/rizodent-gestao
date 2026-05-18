import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type OwnerRole = "admin" | "gerente" | "crc" | "posvenda" | "superadmin" | null;

export const ROLE_LABEL: Record<string, string> = {
  admin: "Admin", gerente: "Gerente", crc: "CRC", posvenda: "Pós-venda", superadmin: "Superadmin",
};
export const ROLE_BADGE_COLOR: Record<string, string> = {
  admin: "bg-orange-900/30 text-orange-400",
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

export default function ShareRoleDialog({ open, onOpenChange, table, rowId, currentOwnerRole, itemLabel = "item", onSaved }: Props) {
  const [value, setValue] = useState<string>(currentOwnerRole ?? "__all__");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setValue(currentOwnerRole ?? "__all__"); }, [currentOwnerRole, rowId]);

  const save = async () => {
    if (!rowId) return;
    setSaving(true);
    const newRole = value === "__all__" ? null : value;
    const { error } = await (supabase.from(table) as any).update({ owner_role: newRole }).eq("id", rowId);
    setSaving(false);
    if (error) { toast.error("Erro ao atualizar compartilhamento"); return; }
    toast.success(newRole ? `${itemLabel} restrito a ${ROLE_LABEL[newRole]}` : `${itemLabel} compartilhado com todos`);
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Compartilhar com papel</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          Defina qual papel pode visualizar este {itemLabel.toLowerCase()}.
        </p>
        <div className="space-y-2 mt-2">
          <Label>Visível para</Label>
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos os papéis (compartilhado)</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="gerente">Gerente</SelectItem>
              <SelectItem value="crc">CRC</SelectItem>
              <SelectItem value="posvenda">Pós-venda</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Admin, Gerente e Superadmin sempre visualizam tudo.
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
