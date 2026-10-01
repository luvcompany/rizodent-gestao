import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

/**
 * Variantes (redesign do CRM, F2):
 *
 * - `variant="default"` (padrão): o visual de sempre (trilho cinza com a aba
 *   ativa em card). É o que o /admin usa; nada mudou nela.
 * - `variant="pill"` (opt-in, é a aba do CRM): abas soltas em pílula. Ativa em
 *   bg-primary com texto primary-foreground e shadow-crm-brand (a sombra da
 *   marca via --tw-shadow, que compõe com o anel de foco do teclado; o
 *   .shadow-brand do index.css apagaria o anel); inativa em
 *   text-muted-foreground com hover bg-muted. Continua sendo o mesmo Tabs do
 *   Radix (role tab/tablist, teclado, value/onValueChange iguais): muda só a
 *   pele. Passe a variante no TabsList e os TabsTrigger dentro dele herdam; o
 *   TabsTrigger também aceita `variant` próprio, que vence o do TabsList.
 *
 *   Contador opcional: um elemento com a classe `tab-count` dentro do gatilho
 *   vira pílula (ativa bg-white/25 texto primary-foreground; inativa bg-muted
 *   text-muted-foreground; h-5 min-w-5 px-1.5 11/600). Regras em index.css.
 *
 *   <TabsList variant="pill">
 *     <TabsTrigger value="todas">Todas <span className="tab-count">33</span></TabsTrigger>
 *   </TabsList>
 */
export type TabsVariant = "default" | "pill";

const TabsVariantContext = React.createContext<TabsVariant>("default");

const Tabs = TabsPrimitive.Root;

type TabsListProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
  variant?: TabsVariant;
};

const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, TabsListProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.List
        ref={ref}
        className={cn(
          "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
          variant === "pill" && "h-auto flex-wrap justify-start gap-1 rounded-none bg-transparent p-0",
          className,
        )}
        {...props}
      />
    </TabsVariantContext.Provider>
  ),
);
TabsList.displayName = TabsPrimitive.List.displayName;

type TabsTriggerProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
  variant?: TabsVariant;
};

const TabsTrigger = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Trigger>, TabsTriggerProps>(
  ({ className, variant, ...props }, ref) => {
    const doList = React.useContext(TabsVariantContext);
    const efetiva = variant ?? doList;
    return (
      <TabsPrimitive.Trigger
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          efetiva === "pill" &&
            "crm-tab-pill h-9 rounded-full px-4 py-0 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-crm-brand data-[state=active]:hover:bg-primary",
          className,
        )}
        {...props}
      />
    );
  },
);
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
