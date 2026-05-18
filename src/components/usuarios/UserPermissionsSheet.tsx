import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Role = "admin" | "gerente" | "crc" | "posvenda" | "superadmin";

type Pipeline = {
  id: string;
  name: string;
  color: string | null;
  allowed_roles: Role[] | null;
};

type WhatsappNumber = {
  id: string;
  phone_number_id: string;
  display_name: string | null;
  phone_e164: string | null;
  is_active: boolean;
};

type IgAccount = {
  id: string;
  username: string | null;
  ig_user_id: string;
};

type Override = {
  scope: "pipeline" | "page" | "action" | "whatsapp_number" | "instagram_account";
  resource_id: string;
  granted: boolean;
};

const PAGES: { slug: string; label: string; defaultRoles: Role[] }[] = [
  { slug: "dashboard", label: "Dashboard", defaultRoles: ["admin", "gerente", "crc", "posvenda"] },
  { slug: "crm", label: "CRM (Conversas)", defaultRoles: ["admin", "gerente", "crc", "posvenda"] },
  { slug: "calendario", label: "Calendário", defaultRoles: ["admin", "gerente", "crc", "posvenda"] },
  { slug: "daily", label: "Daily", defaultRoles: ["admin", "gerente", "crc"] },
  { slug: "relatorios", label: "Relatórios", defaultRoles: ["admin", "gerente"] },
  { slug: "pacientes", label: "Pacientes", defaultRoles: ["admin", "gerente", "crc", "posvenda"] },
  { slug: "usuarios", label: "Usuários", defaultRoles: ["admin"] },
  { slug: "configuracoes", label: "Configurações", defaultRoles: ["admin", "gerente"] },
];

const ACTIONS: { slug: string; label: string; defaultRoles: Role[] }[] = [
  { slug: "delete_leads", label: "Excluir leads", defaultRoles: ["admin", "gerente"] },
  { slug: "transfer_leads", label: "Transferir leads", defaultRoles: ["admin", "gerente"] },
  { slug: "broadcast", label: "Disparar broadcast em massa", defaultRoles: ["admin", "gerente"] },
  { slug: "edit_bots", label: "Editar bots", defaultRoles: ["admin", "gerente"] },
  { slug: "view_financial", label: "Ver relatórios financeiros", defaultRoles: ["admin", "gerente"] },
];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  userId: string;
  userName: string;
  userRole: Role | null;
}

export default function UserPermissionsSheet({ open, onOpenChange, userId, userName, userRole }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [waNumbers, setWaNumbers] = useState<WhatsappNumber[]>([]);
  const [igAccounts, setIgAccounts] = useState<IgAccount[]>([]);
  // overrides keyed by `${scope}:${resource_id}` → granted
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  // dirty: same key set → new desired value or null to clear
  const [dirty, setDirty] = useState<Record<string, boolean | null>>({});

  useEffect(() => {
    if (!open || !userId) return;
    (async () => {
      setLoading(true);
      const [{ data: pls }, { data: ovs }, { data: was }, { data: igs }] = await Promise.all([
        supabase.from("crm_pipelines").select("id,name,color,allowed_roles").order("position"),
        supabase.from("user_permission_overrides").select("scope,resource_id,granted").eq("user_id", userId),
        supabase.from("whatsapp_numbers" as any).select("id,phone_number_id,display_name,phone_e164,is_active").order("display_name"),
        supabase.from("ig_accounts").select("id,username,ig_user_id").order("username"),
      ]);
      setPipelines((pls || []) as Pipeline[]);
      setWaNumbers(((was as unknown) || []) as WhatsappNumber[]);
      setIgAccounts((igs || []) as IgAccount[]);
      const map: Record<string, boolean> = {};
      (ovs || []).forEach((o: any) => { map[`${o.scope}:${o.resource_id}`] = o.granted; });
      setOverrides(map);
      setDirty({});
      setLoading(false);
    })();
  }, [open, userId]);

  const isSuper = userRole === "admin" || userRole === "superadmin";

  const defaultForPipeline = (p: Pipeline) => {
    if (!userRole) return false;
    if (isSuper || userRole === "gerente") return true;
    return !p.allowed_roles || p.allowed_roles.includes(userRole);
  };

  // WA numbers / IG accounts: default is "liberado para todos do tenant"
  const defaultForChannel = () => true;

  const defaultForRole = (allowed: Role[]) => userRole ? allowed.includes(userRole) : false;

  const currentValue = (scope: string, id: string, fallback: boolean) => {
    const key = `${scope}:${id}`;
    if (key in dirty) {
      const v = dirty[key];
      return v === null ? fallback : v;
    }
    if (key in overrides) return overrides[key];
    return fallback;
  };

  const isOverridden = (scope: string, id: string) => {
    const key = `${scope}:${id}`;
    if (key in dirty) return dirty[key] !== null;
    return key in overrides;
  };

  const toggle = (scope: "pipeline" | "page" | "action", id: string, fallback: boolean, next: boolean) => {
    const key = `${scope}:${id}`;
    setDirty(d => {
      const copy = { ...d };
      // If the desired value matches the natural default AND there's no stored override, clear dirty
      const hasStored = key in overrides;
      if (next === fallback && !hasStored) {
        delete copy[key];
      } else if (next === fallback && hasStored) {
        // user wants to reset back to default → mark for delete
        copy[key] = null;
      } else {
        copy[key] = next;
      }
      return copy;
    });
  };

  const resetAll = () => {
    const d: Record<string, boolean | null> = {};
    Object.keys(overrides).forEach(k => { d[k] = null; });
    setDirty(d);
  };

  const dirtyCount = useMemo(() => Object.keys(dirty).length, [dirty]);

  const save = async () => {
    setSaving(true);
    try {
      const toUpsert: any[] = [];
      const toDelete: { scope: string; resource_id: string }[] = [];
      for (const [key, val] of Object.entries(dirty)) {
        const [scope, ...rest] = key.split(":");
        const resource_id = rest.join(":");
        if (val === null) {
          toDelete.push({ scope, resource_id });
        } else {
          toUpsert.push({ user_id: userId, scope, resource_id, granted: val });
        }
      }
      if (toUpsert.length) {
        const { error } = await supabase
          .from("user_permission_overrides")
          .upsert(toUpsert, { onConflict: "user_id,scope,resource_id" });
        if (error) throw error;
      }
      for (const d of toDelete) {
        const { error } = await supabase
          .from("user_permission_overrides")
          .delete()
          .eq("user_id", userId)
          .eq("scope", d.scope)
          .eq("resource_id", d.resource_id);
        if (error) throw error;
      }
      toast.success("Permissões atualizadas");
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro ao salvar: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const RowBadge = ({ scope, id }: { scope: string; id: string }) =>
    isOverridden(scope, id) ? (
      <Badge variant="outline" className="text-xs bg-primary/15 text-primary border-primary/40">Personalizado</Badge>
    ) : (
      <Badge variant="outline" className="text-xs text-muted-foreground">Herdado da role</Badge>
    );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Permissões — {userName}</SheetTitle>
          <SheetDescription>
            Role base: <strong>{userRole || "—"}</strong>. Marque/desmarque para sobrescrever a regra padrão da role apenas para este usuário.
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-primary" />
          </div>
        ) : (
          <div className="mt-4">
            <Tabs defaultValue="pipelines">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="pipelines">Funis</TabsTrigger>
                <TabsTrigger value="pages">Páginas</TabsTrigger>
                <TabsTrigger value="actions">Ações</TabsTrigger>
              </TabsList>

              <TabsContent value="pipelines" className="space-y-2 pt-4">
                {pipelines.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhum funil cadastrado.</p>
                )}
                {pipelines.map(p => {
                  const fallback = defaultForPipeline(p);
                  const val = currentValue("pipeline", p.id, fallback);
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/40 p-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Checkbox
                          checked={val}
                          onCheckedChange={(c) => toggle("pipeline", p.id, fallback, !!c)}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full"
                              style={{ background: p.color || "hsl(var(--primary))" }}
                            />
                            <Label className="cursor-pointer truncate">{p.name}</Label>
                          </div>
                        </div>
                      </div>
                      <RowBadge scope="pipeline" id={p.id} />
                    </div>
                  );
                })}
              </TabsContent>

              <TabsContent value="pages" className="space-y-2 pt-4">
                {PAGES.map(pg => {
                  const fallback = defaultForRole(pg.defaultRoles);
                  const val = currentValue("page", pg.slug, fallback);
                  return (
                    <div key={pg.slug} className="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/40 p-3">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={val}
                          onCheckedChange={(c) => toggle("page", pg.slug, fallback, !!c)}
                        />
                        <Label className="cursor-pointer">{pg.label}</Label>
                      </div>
                      <RowBadge scope="page" id={pg.slug} />
                    </div>
                  );
                })}
              </TabsContent>

              <TabsContent value="actions" className="space-y-2 pt-4">
                {ACTIONS.map(a => {
                  const fallback = defaultForRole(a.defaultRoles);
                  const val = currentValue("action", a.slug, fallback);
                  return (
                    <div key={a.slug} className="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/40 p-3">
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={val}
                          onCheckedChange={(c) => toggle("action", a.slug, fallback, c)}
                        />
                        <Label className="cursor-pointer">{a.label}</Label>
                      </div>
                      <RowBadge scope="action" id={a.slug} />
                    </div>
                  );
                })}
              </TabsContent>
            </Tabs>

            <div className="mt-6 flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={resetAll}
                disabled={Object.keys(overrides).length === 0 && dirtyCount === 0}
              >
                <RotateCcw size={14} className="mr-1" /> Voltar tudo ao padrão
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {dirtyCount > 0 ? `${dirtyCount} alteração(ões) pendente(s)` : "Sem alterações"}
                </span>
                <Button
                  onClick={save}
                  disabled={saving || dirtyCount === 0}
                  className="gradient-orange text-primary-foreground"
                >
                  {saving ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Save size={14} className="mr-1" />}
                  Salvar
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
