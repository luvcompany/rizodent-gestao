import { Toaster as Sonner, toast } from "sonner";
import { useTheme } from "@/hooks/useTheme";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/** Toast no tema efetivo do app (classe `dark` no <html>), não no do sistema operacional. */
/*
 * F2: na casca do CRM o toast vira superfície de card com raio 16 e sombra
 * flutuante (marcador crm-sonner-toast, index.css). Fora dela, o raio cai no
 * --border-radius do próprio sonner (8px), o fundo em bg-background e a sombra
 * em shadow-lg, como antes.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "crm-sonner-toast group toast group-[.toaster]:rounded-[var(--crm-radius-card,var(--border-radius))] group-[.toaster]:bg-[color:var(--crm-sonner-bg,hsl(var(--background)))] group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-crm-float-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
