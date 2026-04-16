import { useRef, useState } from "react";
import { Smile } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";

type EmojiPickerButtonProps = {
  onEmojiSelect: (emoji: string) => void;
  disabled?: boolean;
};

export default function EmojiPickerButton({ onEmojiSelect, disabled }: EmojiPickerButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="p-2 text-muted-foreground hover:text-primary transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          title="Emojis"
        >
          <Smile size={20} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-auto p-0 border-none shadow-lg"
      >
        <Picker
          data={data}
          onEmojiSelect={(emoji: any) => {
            onEmojiSelect(emoji.native);
          }}
          locale="pt"
          theme="auto"
          previewPosition="none"
          skinTonePosition="search"
          set="native"
          maxFrequentRows={2}
        />
      </PopoverContent>
    </Popover>
  );
}
