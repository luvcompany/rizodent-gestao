import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/usePageTitle";

// 404 dos dois apps (público e da clínica). O botão é <Link to="/">, não
// <a href="/">: o Link respeita o basename do router — no app da clínica
// (/<slug>) volta para /<slug>, e não para o login do admin; no app público,
// "/" leva a /admin.
const NotFound = () => {
  usePageTitle("Página não encontrada");
  const location = useLocation();

  useEffect(() => {
    console.error("404: rota inexistente:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-sm text-center">
        <p className="mb-2 text-sm font-medium text-muted-foreground">Erro 404</p>
        <h1 className="mb-2 text-2xl font-bold text-foreground">Página não encontrada</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          O endereço que você abriu não existe ou mudou de lugar.
        </p>
        <Button asChild variant="outline">
          <Link to="/">Voltar ao início</Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
