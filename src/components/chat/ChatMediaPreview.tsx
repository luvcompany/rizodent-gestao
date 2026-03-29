import { Dialog, DialogContent } from "@/components/ui/dialog";

type Props = {
  mediaPreview: { url: string; type: "image" | "video" } | null;
  onClose: () => void;
};

export default function ChatMediaPreview({ mediaPreview, onClose }: Props) {
  return (
    <Dialog open={!!mediaPreview} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-2 bg-background/95 border-border">
        {mediaPreview?.type === "image" ? (
          <img src={mediaPreview.url} alt="" className="w-full h-auto max-h-[85vh] object-contain rounded" />
        ) : mediaPreview?.type === "video" ? (
          <video src={mediaPreview.url} controls autoPlay className="w-full max-h-[85vh] rounded" />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
