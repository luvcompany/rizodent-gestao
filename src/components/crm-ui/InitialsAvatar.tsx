import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function InitialsAvatar({ name, className }: { name: string; className?: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
  return <Avatar className={className}><AvatarFallback className={cn("bg-primary-soft font-semibold text-primary-soft-foreground")}>{initials}</AvatarFallback></Avatar>;
}