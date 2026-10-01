import RegistroDiarioTab from "@/components/RegistroDiarioTab";
import { PageHeader } from "@/components/crm-ui";

const RegistroDiario = () => {
  return (
    <div className="mx-auto max-w-5xl animate-fade-in space-y-6">
      <PageHeader title="Registro diário" subtitle="Registros diários da equipe de atendimento (CRC)" />
      <RegistroDiarioTab />
    </div>
  );
};

export default RegistroDiario;
