import { Dialog, DialogContent } from "@/components/ui/dialog";

type Props = {
  mediaPreview: { url: string; type: "image" | "video" } | null;
  onClose: () => void;
};

export default function ChatMediaPreview({ mediaPreview, onClose }: Props) {
  return (
    <Dialog open={!!mediaPreview} onOpenChange={() => onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl rounded-2xl border-border/60 bg-card/95 p-2 shadow-float">
        {mediaPreview?.type === "image" ? (
          <img src={mediaPreview.url} alt="" className="w-full h-auto max-h-[85vh] object-contain rounded-xl" />
        ) : mediaPreview?.type === "video" ? (
          <video src={mediaPreview.url} controls autoPlay className="w-full max-h-[85vh] rounded-xl" />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
