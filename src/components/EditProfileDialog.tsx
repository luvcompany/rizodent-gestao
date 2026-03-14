import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface EditProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  currentNome: string;
  currentCargo: string | null;
  currentAvatarUrl: string | null;
  currentEmail: string;
  onSaved: () => void;
}

const getAvatarPublicUrl = (path: string) => {
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return data.publicUrl;
};

const EditProfileDialog = ({
  open, onOpenChange, userId, currentNome, currentCargo, currentAvatarUrl, currentEmail, onSaved,
}: EditProfileDialogProps) => {
  const [nome, setNome] = useState(currentNome);
  const [cargo, setCargo] = useState(currentCargo || "");
  const [avatarUrl, setAvatarUrl] = useState(currentAvatarUrl);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Imagem deve ter no máximo 2MB");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${userId}/avatar.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (error) throw error;
      const url = getAvatarPublicUrl(path);
      setAvatarUrl(url + "?t=" + Date.now());
      // Save avatar_url immediately
      await supabase.from("profiles").update({ avatar_url: url }).eq("id", userId);
      toast.success("Foto atualizada!");
    } catch (err: any) {
      toast.error("Erro ao enviar foto: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!nome.trim()) { toast.error("Nome é obrigatório"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("profiles").update({
        nome: nome.trim(),
        cargo: cargo.trim() || null,
      }).eq("id", userId);
      if (error) throw error;
      toast.success("Perfil atualizado!");
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const initials = nome.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar Perfil</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 pt-2">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative group cursor-pointer" onClick={() => fileRef.current?.click()}>
              <Avatar className="h-24 w-24 border-2 border-border">
                <AvatarImage src={avatarUrl || undefined} />
                <AvatarFallback className="bg-primary/20 text-primary text-2xl font-bold">{initials}</AvatarFallback>
              </Avatar>
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/60 opacity-0 group-hover:opacity-100 transition-opacity">
                {uploading ? <Loader2 size={24} className="animate-spin text-primary" /> : <Camera size={24} className="text-primary" />}
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            <p className="text-xs text-muted-foreground">Clique para alterar a foto</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} className="bg-secondary border-border" />
            </div>
            <div className="space-y-2">
              <Label>E-mail</Label>
              <Input value={currentEmail} disabled className="bg-muted border-border text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <Label>Cargo</Label>
              <Input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Ex: Gerente, Recepcionista" className="bg-secondary border-border" />
            </div>
          </div>

          <Button onClick={handleSave} disabled={saving} className="w-full gradient-orange text-primary-foreground font-semibold shadow-orange hover:opacity-90">
            {saving ? "Salvando..." : "Salvar Alterações"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditProfileDialog;
