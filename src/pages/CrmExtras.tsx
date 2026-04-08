import { Users } from "lucide-react";

export default function CrmExtras() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Funções Extras</h1>
      <p className="text-muted-foreground">
        As funcionalidades foram integradas aos seus respectivos painéis:
      </p>
      <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
        <li><strong>Respostas Rápidas</strong> → Automações {">"} Respostas Rápidas</li>
        <li><strong>Score de Lead & Métricas</strong> → Relatórios</li>
        <li><strong>Distribuição Automática</strong> → Config. Funil (botão no painel esquerdo)</li>
        <li><strong>Importação & Notificações</strong> → Configurações</li>
        <li><strong>Campanhas</strong> → Automações {">"} Transmissão</li>
        <li><strong>Webhook Genérico</strong> → Integrações</li>
      </ul>
    </div>
  );
}
