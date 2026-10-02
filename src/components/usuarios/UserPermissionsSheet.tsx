import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Loader2, RotateCcw, Save, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { roleLabel } from "@/lib/roles";

/**
 * Permissões por usuário — só o que o BANCO aplica.
 *
 * Abas: Funis (can_access_pipeline) e Instagram (can_access_instagram_account).
 * Saíram (29/09/2026):
 *   - "Páginas" e "Ações" (EQUIPE-6): gravavam overrides que nenhuma tela,
 *     policy ou função lê — o suporte desligava "Excluir leads", salvava,
 *     recebia "Permissões atualizadas" e nada mudava;
 *   - "WhatsApp" (pedido da sessão 29): os números por usuário são do diálogo
 *     "Números de WhatsApp" da lista de usuários, que grava pela RPC auditada
 *     admin_definir_numeros_usuario. O upsert direto daqui não auditava e
 *     mostrava o gerente como "vê todos os números" — o gerente agora pode ser
 *     restrito (sem marcação = todos).
 *
 * Padrões espelhados do banco (EQUIPE-7):
 *   - superadmin: todos os funis; gerente e crc seguem a regra geral de
 *     can_access_pipeline (allowed_roles NULL ou que inclua o papel);
 *   - crc, gerente e superadmin: todas as contas de Instagram pelo papel — o
 *     override de Instagram não vale para eles, por isso o switch fica
 *     travado com "Acesso pelo papel";
 *   - SDR: o acesso vem de overrides granted=true que o gatilho
 *     sdr_prepara_novo_membro grava para os funis gerais (inclusive o
 *     Instagram) e para todas as contas de Instagram. "Padrão" dela = esses
 *     overrides existirem; "Voltar tudo ao padrão" os recria, nunca apaga;
 *   - pós-venda: só funis que a incluem em allowed_roles; Instagram só com
 *     override;
 *   - recepção/closer: deny-by-default (NULL não libera).
 */

type Role = "gerente" | "crc" | "posvenda" | "recepcao" | "closer" | "sdr" | "superadmin";

type Pipeline = {
  id: string;
  name: string;
  color: string | null;
  allowed_roles: Role[] | null;
  is_posvenda?: boolean | null;
  is_instagram?: boolean | null;
};

/** Funil "geral" do tenant: allowed_roles NULL e não pós-venda (o Instagram
 *  entra) — o mesmo critério do gatilho sdr_prepara_novo_membro no banco. */
const funilGeral = (p: Pipeline) => !p.allowed_roles && !p.is_posvenda;

type IgAccount = {
  id: string;
  username: string | null;
  ig_user_id: string;
};

/** Escopos que esta tela lê e grava. Os demais (whatsapp_number e os antigos
 *  page/action) não são tocados. */
type Escopo = "pipeline" | "instagram_account";
const ESCOPOS: readonly Escopo[] = ["pipeline", "instagram_account"];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  userId: string;
  userName: string;
  userRole: Role | null;
  /** Obrigatório no painel do superadmin: ele opera sobre OUTRO cliente, e sem
   *  escopo explícito as consultas trariam dados de todos os tenants. */
  tenantId?: string | null;
  /** Abre o diálogo "Números de WhatsApp" deste usuário (lista de usuários).
   *  Sem ele, a tela só aponta onde fica. */
  onAbrirNumeros?: () => void;
}

export default function UserPermissionsSheet({ open, onOpenChange, userId, userName, userRole, tenantId, onAbrirNumeros }: Props) {
  const { profile } = useAuth();
  // Cliente das consultas: o informado (painel do superadmin) ou o do próprio
  // usuário logado.
  const tenantAlvo = tenantId ?? profile?.tenant_id ?? null;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [igAccounts, setIgAccounts] = useState<IgAccount[]>([]);
  // overrides keyed by `${scope}:${resource_id}` → granted
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  // dirty: same key set → new desired value or null to clear
  const [dirty, setDirty] = useState<Record<string, boolean | null>>({});

  useEffect(() => {
    if (!open || !userId) return;
    (async () => {
      setLoading(true);
      // Escopo explícito por cliente: no painel do superadmin a RLS não restringe
      // ao tenant (policy de superadmin), então sem o filtro viriam funis e
      // contas de TODOS os clientes.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scoped = <T,>(q: T): T => (tenantAlvo ? (q as any).eq("tenant_id", tenantAlvo) : q);
      const [{ data: pls }, { data: ovs }, { data: igs }] = await Promise.all([
        scoped(supabase.from("crm_pipelines").select("id,name,color,allowed_roles,is_posvenda,is_instagram")).order("name"),
        supabase
          .from("user_permission_overrides")
          .select("scope,resource_id,granted")
          .eq("user_id", userId)
          .in("scope", [...ESCOPOS]),
        scoped(supabase.from("ig_accounts").select("id,username,ig_user_id")).order("username"),
      ]);
      setPipelines((pls || []) as Pipeline[]);
      setIgAccounts((igs || []) as IgAccount[]);
      const map: Record<string, boolean> = {};
      ((ovs || []) as { scope: string; resource_id: string; granted: boolean }[]).forEach((o) => {
        map[`${o.scope}:${o.resource_id}`] = o.granted;
      });
      setOverrides(map);
      setDirty({});
      setLoading(false);
    })();
  }, [open, userId, tenantAlvo]);

  // Só o superadmin vê todos os funis pelo papel. Gerente e crc seguem a regra
  // geral de can_access_pipeline (allowed_roles NULL ou que inclua o papel):
  // funil com allowed_roles sem 'gerente' é negado ao gerente sem override.
  const isSuper = userRole === "superadmin";
  // SDR (rodízio): can_access_pipeline NÃO libera funil com allowed_roles NULL
  // para ela — o acesso real vem dos overrides granted=true gravados pelo
  // gatilho. Um "padrão" dela nunca pode virar "sem override" (isso a deixaria
  // sem funil e sem conta) — ver toggle/resetAll/isOverridden.
  const isSdr = userRole === "sdr";
  // Instagram pelo papel: can_access_instagram_account libera crc, gerente e
  // superadmin ANTES de olhar o override — o switch não teria efeito.
  const instagramPeloPapel = userRole === "crc" || userRole === "gerente" || userRole === "superadmin";

  const defaultForPipeline = (p: Pipeline) => {
    if (!userRole) return false;
    if (isSuper) return true;
    if (isSdr) return funilGeral(p);
    // pós-venda, recepção e closer: só funil que os inclui (NULL não libera).
    if (userRole === "posvenda" || userRole === "recepcao" || userRole === "closer") {
      return p.allowed_roles?.includes(userRole) ?? false;
    }
    return !p.allowed_roles || p.allowed_roles.includes(userRole);
  };

  // Contas de Instagram: liberadas pelo papel para crc/gerente/superadmin; a
  // SDR recebe todas pelo gatilho (override granted=true); os demais só com
  // override (deny-by-default).
  const defaultForChannel = () => instagramPeloPapel || isSdr;

  // SDR: o override granted=true É o padrão dela (funil e Instagram).
  const explicitoParaSdr = (scope: Escopo) => isSdr && (scope === "pipeline" || scope === "instagram_account");

  /** Valor que o banco vai aplicar depois de salvar. Para a SDR, sem override
   *  não há acesso (o padrão dela só vale enquanto o override existe). */
  const currentValue = (scope: Escopo, id: string, fallback: boolean) => {
    const key = `${scope}:${id}`;
    if (explicitoParaSdr(scope)) {
      if (key in dirty) return dirty[key] ?? false;
      return overrides[key] ?? false;
    }
    if (key in dirty) {
      const v = dirty[key];
      return v === null ? fallback : v;
    }
    if (key in overrides) return overrides[key];
    return fallback;
  };

  const isOverridden = (scope: Escopo, id: string) => {
    const key = `${scope}:${id}`;
    if (explicitoParaSdr(scope)) {
      // "Personalizado" só quando o valor efetivo difere do padrão.
      let fallback = true;
      if (scope === "pipeline") {
        const p = pipelines.find((x) => x.id === id);
        fallback = p ? defaultForPipeline(p) : false;
      }
      return currentValue(scope, id, fallback) !== fallback;
    }
    if (key in dirty) return dirty[key] !== null;
    return key in overrides;
  };

  const toggle = (scope: Escopo, id: string, fallback: boolean, next: boolean) => {
    const key = `${scope}:${id}`;
    setDirty((d) => {
      const copy = { ...d };
      // SDR: nunca "apagar o override" — sem override ela não vê o funil nem a
      // conta. O valor é sempre gravado explicitamente.
      if (explicitoParaSdr(scope)) {
        if (overrides[key] === next) delete copy[key];
        else copy[key] = next;
        return copy;
      }
      // Valor igual ao padrão e nada gravado: não há o que salvar.
      const hasStored = key in overrides;
      if (next === fallback && !hasStored) {
        delete copy[key];
      } else if (next === fallback && hasStored) {
        // volta ao padrão → apaga o override
        copy[key] = null;
      } else {
        copy[key] = next;
      }
      return copy;
    });
  };

  const resetAll = () => {
    const d: Record<string, boolean | null> = {};
    Object.keys(overrides).forEach((k) => {
      d[k] = null;
    });
    if (isSdr) {
      // "Padrão" da SDR = recriar os overrides do gatilho (funis gerais e todas
      // as contas de Instagram com granted=true). Apagar tudo a deixaria sem
      // funil e sem conta nenhuma.
      pipelines.forEach((p) => {
        if (!funilGeral(p)) return;
        const k = `pipeline:${p.id}`;
        if (overrides[k] === true) delete d[k];
        else d[k] = true;
      });
      igAccounts.forEach((ig) => {
        const k = `instagram_account:${ig.id}`;
        if (overrides[k] === true) delete d[k];
        else d[k] = true;
      });
    }
    setDirty(d);
  };

  const dirtyCount = useMemo(() => Object.keys(dirty).length, [dirty]);

  const save = async () => {
    setSaving(true);
    try {
      const toUpsert: { user_id: string; scope: Escopo; resource_id: string; granted: boolean }[] = [];
      const toDelete: { scope: Escopo; resource_id: string }[] = [];
      for (const [key, val] of Object.entries(dirty)) {
        const [scopeRaw, ...rest] = key.split(":");
        const scope = scopeRaw as Escopo;
        if (!ESCOPOS.includes(scope)) continue;
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
    } catch (err: unknown) {
      const msg = err && typeof err === "object" && "message" in err ? String((err as { message?: unknown }).message ?? "") : "";
      toast.error(msg ? `Não foi possível salvar as permissões: ${msg}` : "Não foi possível salvar as permissões.");
    } finally {
      setSaving(false);
    }
  };

  const RowBadge = ({ scope, id }: { scope: Escopo; id: string }) =>
    isOverridden(scope, id) ? (
      <Badge variant="outline" className="text-xs bg-primary/15 text-primary border-primary/40">Personalizado</Badge>
    ) : (
      <Badge variant="outline" className="text-xs text-muted-foreground">Padrão do papel</Badge>
    );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Permissões — {userName}</SheetTitle>
          <SheetDescription>
            Papel: <strong>{roleLabel(userRole)}</strong>. Marque ou desmarque para mudar o padrão do papel só para
            este usuário.
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-primary" />
          </div>
        ) : (
          <div className="mt-4">
            <div className="mb-4 flex items-start gap-2 rounded-md border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
              <Smartphone size={14} className="mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p>
                  Os números de WhatsApp de cada usuário ficam em{" "}
                  <strong className="font-medium text-foreground">Números de WhatsApp</strong>, no menu da linha dele
                  na lista de usuários.
                </p>
                {onAbrirNumeros && (
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onAbrirNumeros}>
                    Abrir Números de WhatsApp
                  </Button>
                )}
              </div>
            </div>

            <Tabs defaultValue="pipelines">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="pipelines">Funis</TabsTrigger>
                <TabsTrigger value="instagram">Instagram</TabsTrigger>
              </TabsList>

              <TabsContent value="pipelines" className="space-y-2 pt-4">
                {isSdr && (
                  <p className="rounded-md border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
                    SDR: o padrão são os funis gerais da clínica (inclusive o do Instagram; sem pós-venda). O acesso
                    dela é gravado como permissão explícita por funil — "Voltar tudo ao padrão" recria essas
                    permissões em vez de apagá-las.
                  </p>
                )}
                {pipelines.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhum funil cadastrado.</p>
                )}
                {pipelines.map((p) => {
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

              <TabsContent value="instagram" className="space-y-2 pt-4">
                {instagramPeloPapel && (
                  <p className="rounded-md border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
                    Este papel vê todas as contas de Instagram do cliente.
                  </p>
                )}
                {isSdr && (
                  <p className="rounded-md border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
                    SDR: o padrão são todas as contas de Instagram da clínica, gravadas como permissão explícita.
                  </p>
                )}
                {igAccounts.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhuma conta de Instagram conectada.</p>
                )}
                {igAccounts.map((ig) => {
                  const fallback = defaultForChannel();
                  const val = instagramPeloPapel ? true : currentValue("instagram_account", ig.id, fallback);
                  return (
                    <div key={ig.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/40 p-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Switch
                          checked={val}
                          disabled={instagramPeloPapel}
                          onCheckedChange={(c) => toggle("instagram_account", ig.id, fallback, c)}
                          aria-label={`Acesso à conta @${ig.username || ig.ig_user_id}`}
                        />
                        <div className="min-w-0">
                          <Label className="cursor-pointer truncate block">@{ig.username || ig.ig_user_id}</Label>
                          <span className="text-xs text-muted-foreground">ID: {ig.ig_user_id}</span>
                        </div>
                      </div>
                      {instagramPeloPapel ? (
                        <Badge variant="outline" className="text-xs text-muted-foreground">Acesso pelo papel</Badge>
                      ) : (
                        <RowBadge scope="instagram_account" id={ig.id} />
                      )}
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
                disabled={!isSdr && Object.keys(overrides).length === 0 && dirtyCount === 0}
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
                  className="gradient-brand text-primary-foreground"
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
