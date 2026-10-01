import type { ComponentProps } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type PillTabsProps = ComponentProps<typeof Tabs> & { items: Array<{ value: string; label: string; content?: React.ReactNode }> };
export function PillTabs({ items, ...props }: PillTabsProps) {
  return <Tabs {...props}><TabsList variant="pill">{items.map((item) => <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>)}</TabsList>{items.map((item) => item.content === undefined ? null : <TabsContent key={item.value} value={item.value}>{item.content}</TabsContent>)}</Tabs>;
}