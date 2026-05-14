import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Copy, Eye, EyeOff, Save, RefreshCw, Info } from "lucide-react";
import { toast } from "sonner";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

type Row = {
  tenant_id: string;
  // WhatsApp
  whatsapp_app_id: string | null;
  whatsapp_app_secret: string | null;
  whatsapp_token: string | null;
  whatsapp_phone_number_id: string | null;
  whatsapp_waba_id: string | null;
  whatsapp_verify_token: string;
  whatsapp_enabled: boolean;
  // Meta / Instagram
  meta_app_id: string | null;
  meta_app_secret: string | null;
  instagram_app_secret: string | null;
  instagram_verify_token: string;
  instagram_redirect_uri: string | null;
  instagram_enabled: boolean;
};

const empty: Partial<Row> = {
  whatsapp_app_id: "",
  whatsapp_app_secret: "",
  whatsapp_token: "",
  whatsapp_phone_number_id: "",
  whatsapp_waba_id: "",
  whatsapp_enabled: false,
  meta_app_id: "",
  meta_app_secret: "",
  instagram_app_secret: "",
  instagram_redirect_uri: "",
  instagram_enabled: false,
};

function copy(value: string, label: string) {
  if (!value) return;
  navigator.clipboard.writeText(value);
  toast.success(`${label} copiado`);
}

function MaskedField({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="font-mono text-xs"
        />
        <Button type="button" variant="outline" size="icon" onClick={() => setShow((s) => !s)}>
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </Button>
      </div>
    </div>
  );
}

export default function MetaAppCredentialsSection() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [row, setRow] = useState<Partial<Row>>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", (await supabase.auth.getUser()).data.user?.id || "")
      .maybeSingle();
    const tid = (profile as any)?.tenant_id || null;
    setTenantId(tid);

    if (tid) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("slug")
        .eq("id", tid)
        .maybeSingle();
      setTenantSlug((tenant as any)?.slug || null);

      const { data, error } = await (supabase as any)
        .from("tenant_meta_credentials")
        .select("*")
        .eq("tenant_id", tid)
        .maybeSingle();
      if (error) console.warn("[meta-creds] load error", error);
      if (data) setRow(data as Row);
      else setRow({ ...empty, tenant_id: tid });
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!tenantId) {
      toast.error("Tenant não identificado");
      return;
    }
    setSaving(true);
    const payload = { ...row, tenant_id: tenantId };
    const { error } = await (supabase as any)
      .from("tenant_meta_credentials")
      .upsert(payload, { onConflict: "tenant_id" });
    setSaving(false);
    if (error) {
      toast.error(`Erro ao salvar: ${error.message}`);
      return;
    }
    toast.success("Credenciais salvas");
    load();
  };

  const whatsappWebhookUrl = tenantSlug
    ? `${SUPABASE_URL}/functions/v1/whatsapp-webhook/${tenantSlug}`
    : `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;
  const instagramWebhookUrl = tenantSlug
    ? `${SUPABASE_URL}/functions/v1/instagram-lite-webhook/${tenantSlug}`
    : `${SUPABASE_URL}/functions/v1/instagram-lite-webhook`;
  const instagramOauthUrl = tenantSlug
    ? `${SUPABASE_URL}/functions/v1/instagram-oauth-callback/${tenantSlug}`
    : `${SUPABASE_URL}/functions/v1/instagram-oauth-callback`;

  if (loading) {
    return (
      <Card className="mt-6"><CardContent className="p-5 text-sm text-muted-foreground">Carregando…</CardContent></Card>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      <div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
        <Info size={14} className="mt-0.5 text-primary shrink-0" />
        <div>
          <p className="font-medium text-foreground">Credenciais Meta App por cliente (multi-tenant)</p>
          <p>
            Configure aqui as credenciais do <strong>seu próprio app Meta</strong> para este cliente.
            Os campos abaixo só passam a valer depois que você marcar como ativo. Enquanto desativados,
            o sistema continua usando as credenciais globais (comportamento atual).
          </p>
        </div>
      </div>

      {/* WhatsApp */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              WhatsApp Business — App próprio
              {row.whatsapp_enabled
                ? <Badge className="bg-green-600">Ativo</Badge>
                : <Badge variant="outline">Usando credenciais globais</Badge>}
            </h3>
            <div className="flex items-center gap-2">
              <Label className="text-xs">Ativar</Label>
              <Switch
                checked={!!row.whatsapp_enabled}
                onCheckedChange={(v) => setRow((r) => ({ ...r, whatsapp_enabled: v }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>App ID</Label>
              <Input value={row.whatsapp_app_id || ""} onChange={(e) => setRow({ ...row, whatsapp_app_id: e.target.value })} placeholder="123456789012345" />
            </div>
            <MaskedField label="App Secret" value={row.whatsapp_app_secret || ""} onChange={(v) => setRow({ ...row, whatsapp_app_secret: v })} />
            <MaskedField label="Token (System User permanente)" value={row.whatsapp_token || ""} onChange={(v) => setRow({ ...row, whatsapp_token: v })} />
            <div>
              <Label>Phone Number ID</Label>
              <Input value={row.whatsapp_phone_number_id || ""} onChange={(e) => setRow({ ...row, whatsapp_phone_number_id: e.target.value })} placeholder="111122223333444" />
            </div>
            <div>
              <Label>WABA ID</Label>
              <Input value={row.whatsapp_waba_id || ""} onChange={(e) => setRow({ ...row, whatsapp_waba_id: e.target.value })} placeholder="555566667777888" />
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Para colar no Meta Developers (Webhooks → WhatsApp)
            </Label>
            <div>
              <Label>Callback URL</Label>
              <div className="flex gap-2">
                <Input readOnly value={whatsappWebhookUrl} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => copy(whatsappWebhookUrl, "URL")}><Copy size={14} /></Button>
              </div>
            </div>
            <div>
              <Label>Verify Token (gerado automaticamente)</Label>
              <div className="flex gap-2">
                <Input readOnly value={row.whatsapp_verify_token || "—"} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => copy(row.whatsapp_verify_token || "", "Verify token")}><Copy size={14} /></Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Instagram / Meta */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              Instagram / Meta — App próprio
              {row.instagram_enabled
                ? <Badge className="bg-green-600">Ativo</Badge>
                : <Badge variant="outline">Usando credenciais globais</Badge>}
            </h3>
            <div className="flex items-center gap-2">
              <Label className="text-xs">Ativar</Label>
              <Switch
                checked={!!row.instagram_enabled}
                onCheckedChange={(v) => setRow((r) => ({ ...r, instagram_enabled: v }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Meta App ID</Label>
              <Input value={row.meta_app_id || ""} onChange={(e) => setRow({ ...row, meta_app_id: e.target.value })} placeholder="123456789012345" />
            </div>
            <MaskedField label="Meta App Secret" value={row.meta_app_secret || ""} onChange={(v) => setRow({ ...row, meta_app_secret: v })} />
            <MaskedField label="Instagram App Secret (se diferente)" value={row.instagram_app_secret || ""} onChange={(v) => setRow({ ...row, instagram_app_secret: v })} />
            <div className="md:col-span-2">
              <Label>Redirect URI configurada no Meta App</Label>
              <Input value={row.instagram_redirect_uri || instagramOauthUrl} onChange={(e) => setRow({ ...row, instagram_redirect_uri: e.target.value })} className="font-mono text-xs" />
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Para colar no Meta Developers (Webhooks → Instagram)
            </Label>
            <div>
              <Label>Callback URL</Label>
              <div className="flex gap-2">
                <Input readOnly value={instagramWebhookUrl} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => copy(instagramWebhookUrl, "URL")}><Copy size={14} /></Button>
              </div>
            </div>
            <div>
              <Label>Verify Token (gerado automaticamente)</Label>
              <div className="flex gap-2">
                <Input readOnly value={row.instagram_verify_token || "—"} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => copy(row.instagram_verify_token || "", "Verify token")}><Copy size={14} /></Button>
              </div>
            </div>
            <div>
              <Label>Sugestão de Redirect URI (Instagram OAuth)</Label>
              <div className="flex gap-2">
                <Input readOnly value={instagramOauthUrl} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => copy(instagramOauthUrl, "URL")}><Copy size={14} /></Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={load} disabled={loading || saving}>
          <RefreshCw size={14} className="mr-1" /> Recarregar
        </Button>
        <Button onClick={save} disabled={saving}>
          <Save size={14} className="mr-1" />
          {saving ? "Salvando…" : "Salvar credenciais"}
        </Button>
      </div>
    </div>
  );
}
