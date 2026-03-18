import RegistroDiarioTab from "@/components/RegistroDiarioTab";

const RegistroDiario = () => {
  return (
    <div className="mx-auto max-w-4xl animate-fade-in space-y-6">
      <div className="mb-2">
        <h1 className="text-2xl font-bold">Registro Diário</h1>
        <p className="text-sm text-muted-foreground">Registros diários da equipe de atendimento (CRC)</p>
      </div>
      <RegistroDiarioTab />
    </div>
  );
};

export default RegistroDiario;
