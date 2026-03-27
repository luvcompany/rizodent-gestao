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
      className={`pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-lg bg-card/90 backdrop-blur-sm border border-border shadow-lg text-sm text-foreground transition-all duration-300 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
      }`}
    >
      {isStageChange ? (
        <ArrowRight size={14} className="text-primary flex-shrink-0" />
      ) : (
        <Edit size={14} className="text-primary flex-shrink-0" />
      )}
      <span>{activity.content}</span>
      <button onClick={() => onDismiss(activity.id)} className="text-muted-foreground hover:text-foreground ml-1">
        <X size={12} />
      </button>
    </div>
  );
}
