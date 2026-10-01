import { PageHeader, SectionCard } from "@/components/crm-ui";

export default function CrmExtras() {
  return (
    <div className="space-y-5">
      <PageHeader title="Funções extras" subtitle="As funcionalidades foram integradas aos seus respectivos painéis." />
      <SectionCard>
      <ul className="space-y-3 text-sm text-muted-foreground list-disc list-inside">
        <li><strong>Respostas Rápidas</strong> → Automações {">"} Respostas Rápidas</li>
        <li><strong>Score de Lead & Métricas</strong> → Relatórios</li>
        <li><strong>Distribuição Automática</strong> → Config. Funil (botão no painel esquerdo)</li>
        <li><strong>Importação & Notificações</strong> → Configurações</li>
        <li><strong>Campanhas</strong> → Automações {">"} Transmissão</li>
        <li><strong>Webhook Genérico</strong> → Integrações</li>
      </ul>
      </SectionCard>
    </div>
  );
}
