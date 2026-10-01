import { isToday, isYesterday, format, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";

type Props = { date: Date };

function formatDateLabel(date: Date): string {
  if (isToday(date)) return "Hoje";
  if (isYesterday(date)) return "Ontem";
  const diff = differenceInCalendarDays(new Date(), date);
  if (diff < 7) {
    // Show weekday name like WhatsApp (e.g. "domingo")
    return format(date, "EEEE", { locale: ptBR });
  }
  return format(date, "dd/MM/yyyy");
}

export default function ChatDateSeparator({ date }: Props) {
  return (
    <div className="flex items-center justify-center py-2 select-none">
      <span className="rounded-full border border-border/60 bg-card px-3 py-1 text-[11px] font-medium capitalize text-muted-foreground shadow-card">
        {formatDateLabel(date)}
      </span>
    </div>
  );
}
