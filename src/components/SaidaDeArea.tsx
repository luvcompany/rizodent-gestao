import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";

/**
 * Tira a pessoa de uma área que não é do perfil dela e avisa. O id evita aviso
 * duplicado (StrictMode, re-render).
 */
export default function SaidaDeArea({ destino }: { destino: string }) {
  useEffect(() => {
    toast.error("Esta área não faz parte do seu perfil.", { id: "fora-do-perfil" });
  }, []);
  return <Navigate to={destino} replace />;
}
