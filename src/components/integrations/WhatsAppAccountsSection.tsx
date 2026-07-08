import { useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, Power, Trash2, Plus, Settings, XCircle, GitBranch } from "lucide-react";
import whatsappLogo from "@/assets/whatsapp-logo.png";
import WhatsAppEmbeddedSignupButton from "@/components/integrations/WhatsAppEmbeddedSignupButton";

const WA_GREEN = "#25D366";

type WhatsAppConfig = {
  token: string;
  phone_number_id: string;
  waba_id: string;
  app_id: string;
  api_version: string;
  webhook_verify_token: string;
  display_name: string;
  pipeline_id?: string;
};

type WhatsAppEntry = {
  id?: string;
  key: string;
  config: WhatsAppConfig;
  status: string;
};

type Pipeline = { id: string; name: string };

interface Props {
  entries: WhatsAppEntry[];
  pipelines: Pipeline[];
  onReload: () => void;
  onNew: () => void;
  onEdit: (entry: WhatsAppEntry) => void;
  onToggle: (entry: WhatsAppEntry, e: React.MouseEvent) => void;
  onDelete: (entry: WhatsAppEntry) => void;
}

function maskPhoneId(id: string) {
  if (!id) return "—";
  if (id.length <= 4) return `••••${id}`;
  return `••••${id.slice(-4)}`;
}

export default function WhatsAppAccountsSection({
  entries,
  pipelines,
  onReload,
  onNew,
  onEdit,
  onToggle,
  onDelete,
}: Props) {
  const hasAccounts = entries.length > 0;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const waStatus = params.get("whatsapp");
    if (waStatus === "connected") {
      const count = params.get("count");
      toast.success(`WhatsApp conectado! ${count ?? 0} número(s) vinculado(s).`);
      window.history.replaceState({}, "", window.location.pathname);
      onReload();
    } else if (waStatus === "error") {
      toast.error("Falha ao conectar o WhatsApp. Tente novamente.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-foreground flex items-center gap-2">
          <img src={whatsappLogo} alt="WhatsApp" width={20} height={20} className="rounded-full" /> WhatsApp
        </h2>
        {hasAccounts && (
          <div
            className="[&_button]:!bg-[color:var(--wa-green)] [&_button]:!text-white [&_button]:!border-0 [&_button:hover]:!opacity-90"
            style={{ ["--wa-green" as any]: WA_GREEN }}
          >
            <WhatsAppEmbeddedSignupButton onConnected={onReload} />
          </div>
        )}
      </div>

      {!hasAccounts && (
        <Card>
          <CardContent className="p-6 flex flex-col items-center text-center gap-4">
            <div className="p-4 rounded-full" style={{ backgroundColor: `${WA_GREEN}1A` }}>
              <img src={whatsappLogo} alt="WhatsApp" width={40} height={40} className="rounded-full" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground mb-1">Conecte seu WhatsApp Business</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Conecte para enviar e receber mensagens direto pelo CRM.
              </p>
            </div>
            <div
              className="[&_button]:!bg-[color:var(--wa-green)] [&_button]:!text-white [&_button]:!border-0 [&_button:hover]:!opacity-90"
              style={{ ["--wa-green" as any]: WA_GREEN }}
            >
              <WhatsAppEmbeddedSignupButton onConnected={onReload} />
            </div>
          </CardContent>
        </Card>
      )}

      {hasAccounts && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map((entry) => {
            const c = entry.config;
            const isConnected = entry.status === "connected";
            const isDisabled = entry.status === "disabled";
            const pName = pipelines.find((p) => p.id === c.pipeline_id)?.name;
            return (
              <Card key={entry.key}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-2 rounded-lg" style={{ backgroundColor: `${WA_GREEN}1A` }}>
                      <img src={whatsappLogo} alt="WhatsApp" width={28} height={28} className="rounded-full" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={!isDisabled}
                        onCheckedChange={() => {}}
                        onClick={(e) => onToggle(entry, e as unknown as React.MouseEvent)}
                      />
                      {isConnected ? (
                        <Badge className="bg-green-900/30 text-green-400 border-0">
                          <CheckCircle size={12} className="mr-1" /> Ativo
                        </Badge>
                      ) : isDisabled ? (
                        <Badge variant="secondary" className="text-muted-foreground">
                          <Power size={12} className="mr-1" /> Desativado
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-muted-foreground">
                          <XCircle size={12} className="mr-1" /> Não conectado
                        </Badge>
                      )}
                    </div>
                  </div>
                  <h3
                    className={`font-semibold text-sm mb-1 truncate ${
                      isDisabled ? "text-muted-foreground" : "text-foreground"
                    }`}
                  >
                    {c.display_name || entry.key}
                  </h3>
                  <p className="text-xs text-muted-foreground font-mono truncate">
                    ID: {maskPhoneId(c.phone_number_id)}
                  </p>
                  {pName && (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <GitBranch size={12} /> Funil: {pName}
                    </p>
                  )}
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => onEdit(entry)}>
                      <Settings size={12} className="mr-1" /> Configurar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-destructive hover:text-destructive"
                      onClick={() => onDelete(entry)}
                    >
                      <Trash2 size={12} className="mr-1" /> Remover
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
