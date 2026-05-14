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

type MetaInfo = {
  tenant_id: string;
  tenant_slug: string | null;
  meta_app_version: "v1" | "v2";
  whatsapp: { callback_url: string; verify_token: string };
  instagram: { callback_url: string; verify_token: string; oauth_redirect_uri: string; app_id: string };
};

type TenantRow = {
  tenant_id: string;
  whatsapp_token: string | null;
  whatsapp_phone_number_id: string | null;
  whatsapp_waba_id: string | null;
  whatsapp_enabled: boolean;
  instagram_enabled: boolean;
};

const empty: Partial<TenantRow> = {
  whatsapp_token: "",
  whatsapp_phone_number_id: "",
  whatsapp_waba_id: "",
  whatsapp_enabled: false,
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
  const [info, setInfo] = useState<MetaInfo | null>(null);
  const [row, setRow] = useState<Partial<TenantRow>>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data: infoRes, error: infoErr } = await supabase.functions.invoke("tenant-meta-info");
      if (infoErr || !infoRes) {
        console.warn("[meta-creds] info error", infoErr);
        setInfo(null);
        setLoading(false);
        return;
      }
      const meta = infoRes as MetaInfo;
      setInfo(meta);

      let { data } = await (supabase as any)
        .from("tenant_meta_credentials")
        .select("tenant_id, whatsapp_token, whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_enabled, instagram_enabled")
        .eq("tenant_id", meta.tenant_id)
        .maybeSingle();
      if (!data) {
        const ins = await (supabase as any)
          .from("tenant_meta_credentials")
          .insert({ tenant_id: meta.tenant_id })
          .select("tenant_id, whatsapp_token, whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_enabled, instagram_enabled")
          .maybeSingle();
        data = ins.data;
      }
      setRow((data as TenantRow) ?? { ...empty, tenant_id: meta.tenant_id });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!info) return;
    setSaving(true);
    const payload = {
      tenant_id: info.tenant_id,
      whatsapp_token: row.whatsapp_token || null,
      whatsapp_phone_number_id: row.whatsapp_phone_number_id || null,
      whatsapp_waba_id: row.whatsapp_waba_id || null,
      whatsapp_enabled: !!row.whatsapp_enabled,
      instagram_enabled: !!row.instagram_enabled,
    };
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

  if (loading) {
    return (
      <Card className="mt-6"><CardContent className="p-5 text-sm text-muted-foreground">Carregando…</CardContent></Card>
    );
  }

  if (!info) return null;

  // Rizodent (v1) usa o app legado e os secrets globais — não precisa configurar nada aqui.
  if (info.meta_app_version === "v1") {
    return null;
  }

  return (
    <div className="mt-8 space-y-6">
      <div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
        <Info size={14} className="mt-0.5 text-primary shrink-0" />
        <div>
          <p className="font-medium text-foreground">Conecte sua conta ao nosso Meta App</p>
          <p>
            As URLs de Callback e os Verify Tokens abaixo já estão prontos —
            eles são os mesmos para todos os clientes (já cadastrados no nosso Meta App).
            Você só precisa preencher o <strong>token de acesso</strong> e o <strong>Phone Number ID</strong> do
            seu próprio número WhatsApp Business, e conectar sua conta do Instagram via OAuth.
          </p>
        </div>
      </div>

      {/* WhatsApp */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              WhatsApp Business
              {row.whatsapp_enabled
                ? <Badge className="bg-green-600">Ativo</Badge>
                : <Badge variant="outline">Inativo</Badge>}
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
            <MaskedField
              label="Token de acesso (System User permanente)"
              value={row.whatsapp_token || ""}
              onChange={(v) => setRow({ ...row, whatsapp_token: v })}
              placeholder="EAAG…"
            />
            <div>
              <Label>Phone Number ID</Label>
              <Input
                value={row.whatsapp_phone_number_id || ""}
                onChange={(e) => setRow({ ...row, whatsapp_phone_number_id: e.target.value })}
                placeholder="111122223333444"
              />
            </div>
            <div>
              <Label>WABA ID (opcional)</Label>
              <Input
                value={row.whatsapp_waba_id || ""}
                onChange={(e) => setRow({ ...row, whatsapp_waba_id: e.target.value })}
                placeholder="555566667777888"
              />
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Para o nosso técnico cadastrar no Meta Developers (já feito uma vez por app)
            </Label>
            <div>
              <Label>Callback URL</Label>
              <div className="flex gap-2">
                <Input readOnly value={info.whatsapp.callback_url} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => copy(info.whatsapp.callback_url, "URL")}><Copy size={14} /></Button>
              </div>
            </div>
            <div>
              <Label>Verify Token</Label>
              <div className="flex gap-2">
                <Input readOnly value={info.whatsapp.verify_token || "—"} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => copy(info.whatsapp.verify_token || "", "Verify token")}><Copy size={14} /></Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Instagram */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              Instagram
              {row.instagram_enabled
                ? <Badge className="bg-green-600">Ativo</Badge>
                : <Badge variant="outline">Inativo</Badge>}
            </h3>
            <div className="flex items-center gap-2">
              <Label className="text-xs">Ativar</Label>
              <Switch
                checked={!!row.instagram_enabled}
                onCheckedChange={(v) => setRow((r) => ({ ...r, instagram_enabled: v }))}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            A conexão da conta Instagram é feita pelo botão "Conectar Instagram" mais acima na página
            (fluxo OAuth). Esta seção apenas habilita o canal e mostra as URLs do app.
          </p>

          <div className="border-t pt-4 space-y-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              URLs do app (uso interno)
            </Label>
            <div>
              <Label>Callback URL</Label>
              <div className="flex gap-2">
                <Input readOnly value={info.instagram.callback_url} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => copy(info.instagram.callback_url, "URL")}><Copy size={14} /></Button>
              </div>
            </div>
            <div>
              <Label>Verify Token</Label>
              <div className="flex gap-2">
                <Input readOnly value={info.instagram.verify_token || "—"} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => copy(info.instagram.verify_token || "", "Verify token")}><Copy size={14} /></Button>
              </div>
            </div>
            <div>
              <Label>OAuth Redirect URI</Label>
              <div className="flex gap-2">
                <Input readOnly value={info.instagram.oauth_redirect_uri} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => copy(info.instagram.oauth_redirect_uri, "URL")}><Copy size={14} /></Button>
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
