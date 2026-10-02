import { useEffect, useState } from "react";
import { ArrowRight, Edit, X } from "lucide-react";

type ActivityToastItem = {
  id: string;
  content: string;
};

type Props = {
  activities: ActivityToastItem[];
  onDismiss: (id: string) => void;
};

export default function ChatActivityToast({ activities, onDismiss }: Props) {
  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex flex-col gap-2 pointer-events-none">
      {activities.map((a) => (
        <ToastItem key={a.id} activity={a} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ activity, onDismiss }: { activity: ActivityToastItem; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(activity.id), 300);
    }, 4000);
    return () => clearTimeout(timer);
  }, [activity.id, onDismiss]);

  const isStageChange = activity.content.includes("Etapa alterada") || activity.content.includes("movido");

  return (
    <div
      className={`pointer-events-auto flex items-center gap-2.5 rounded-xl border border-border/60 bg-card/95 py-2 pl-2 pr-3 text-[13px] font-medium text-foreground shadow-float backdrop-blur-sm transition-all duration-300 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
      }`}
    >
      {isStageChange ? (
        <ArrowRight size={14} strokeWidth={1.75} className="box-content h-3.5 w-3.5 flex-shrink-0 rounded-full bg-primary-soft p-1.5 text-primary-soft-fg" />
      ) : (
        <Edit size={14} strokeWidth={1.75} className="box-content h-3.5 w-3.5 flex-shrink-0 rounded-full bg-primary-soft p-1.5 text-primary-soft-fg" />
      )}
      <span>{activity.content}</span>
      <button onClick={() => onDismiss(activity.id)} className="ml-1 rounded-full p-1 text-tertiary transition-colors hover:bg-muted hover:text-foreground">
        <X size={12} strokeWidth={1.75} />
      </button>
    </div>
  );
}
