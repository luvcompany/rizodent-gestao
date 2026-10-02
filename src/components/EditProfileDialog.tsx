import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Camera, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { mensagemDeErro } from "@/lib/mensagemDeErro";
import { cabecalhoDaAssinatura } from "@/lib/assinaturaMensagem";

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

/**
 * "Editar perfil" — o diálogo que o CrmLayout e o AppLayout abrem para TODOS
 * os papéis. Aqui ficam as preferências pessoais: foto, nome, cargo, a
 * assinatura nas mensagens (X-3: antes só existia em /configuracoes, que
 * recepção, closer, SDR e pós-venda não abrem) e o atalho "Alterar senha"
 * (X-5/SDR-19).
 */
const EditProfileDialog = ({
  open, onOpenChange, userId, currentNome, currentCargo, currentAvatarUrl, currentEmail, onSaved,
}: EditProfileDialogProps) => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [nome, setNome] = useState(currentNome);
  const [cargo, setCargo] = useState(currentCargo || "");
  const [avatarUrl, setAvatarUrl] = useState(currentAvatarUrl);
  const [assinatura, setAssinatura] = useState<boolean>(profile?.signature_enabled ?? false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // O diálogo fica montado (open liga/desliga): a cada abertura, o formulário
  // volta ao que está gravado — senão mostrava o nome de antes de um refresh.
  useEffect(() => {
    if (!open) return;
    setNome(currentNome);
    setCargo(currentCargo || "");
    setAvatarUrl(currentAvatarUrl);
    setAssinatura(profile?.signature_enabled ?? false);
  }, [open, currentNome, currentCargo, currentAvatarUrl, profile?.signature_enabled]);

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
      // Otimista: mostra a foto nova já — mas guarda a anterior, porque se o
      // banco recusar a gravação a prévia mentiria até fechar o diálogo.
      const avatarAnterior = avatarUrl;
      setAvatarUrl(url + "?t=" + Date.now());
      // Save avatar_url immediately
      const { data, error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: url })
        .eq("id", userId)
        .select("id");
      if (updateError) {
        setAvatarUrl(avatarAnterior);
        throw updateError;
      }
      if (!data || data.length === 0) {
        setAvatarUrl(avatarAnterior);
        toast.error("Seu perfil não tem permissão para atualizar a foto.");
        return;
      }
      toast.success("Foto atualizada!");
    } catch (err) {
      toast.error("Erro ao enviar foto: " + mensagemDeErro(err));
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!nome.trim()) { toast.error("Nome é obrigatório"); return; }
    setSaving(true);
    try {
      // Nome, cargo e assinatura no mesmo UPDATE. RLS que recusa devolve 0
      // linhas sem erro: o .select() torna isso visível.
      const { data, error } = await supabase.from("profiles").update({
        nome: nome.trim(),
        cargo: cargo.trim() || null,
        signature_enabled: assinatura,
      }).eq("id", userId).select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        toast.error("Seu perfil não tem permissão para esta alteração.");
        return;
      }
      toast.success("Perfil atualizado!");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error("Erro ao salvar o perfil: " + mensagemDeErro(err));
    } finally {
      setSaving(false);
    }
  };

  const alterarSenha = () => {
    onOpenChange(false);
    navigate("/change-password");
  };

  const initials = nome.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const nomeDaPrevia = nome.trim() || "Seu nome";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-1.5rem)] gap-0 overflow-y-auto rounded-2xl p-0 sm:max-w-md sm:rounded-2xl">
        <DialogHeader className="px-5 pb-1 pt-5 text-left sm:px-6 sm:pt-6">
          <DialogTitle className="text-xl font-semibold tracking-tight">Editar Perfil</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-2.5 rounded-2xl bg-muted/60 px-4 py-5">
            <div className="relative group cursor-pointer rounded-full ring-4 ring-card" onClick={() => fileRef.current?.click()}>
              <Avatar className="h-20 w-20">
                <AvatarImage src={avatarUrl || undefined} />
                <AvatarFallback className="bg-primary-soft text-2xl font-bold text-primary-soft-fg">{initials}</AvatarFallback>
              </Avatar>
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70 opacity-0 group-hover:opacity-100 transition-opacity">
                {uploading ? <Loader2 size={22} className="animate-spin text-primary" /> : <Camera size={22} className="text-primary" />}
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            <p className="text-xs font-medium text-muted-foreground">Clique para alterar a foto</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium text-foreground">Nome</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} className="h-10 rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium text-foreground">E-mail</Label>
              <Input value={currentEmail} disabled className="h-10 rounded-xl bg-muted text-muted-foreground disabled:opacity-100" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium text-foreground">Cargo</Label>
              <Input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Ex: Gerente, Recepcionista" className="h-10 rounded-xl" />
            </div>
          </div>

          {/* Assinatura nas mensagens (X-3) */}
          <div className="space-y-3 rounded-2xl border border-border/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Label htmlFor="perfil-assinatura" className="text-sm font-semibold leading-5 text-foreground">Assinar mensagens com meu nome</Label>
                <p className="mt-0.5 text-xs leading-[18px] text-muted-foreground">O paciente vê quem respondeu: seu nome em negrito no topo de cada mensagem.</p>
              </div>
              <Switch id="perfil-assinatura" className="mt-0.5 shrink-0" checked={assinatura} onCheckedChange={setAssinatura} />
            </div>
            <div className="rounded-xl bg-muted/60 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary">Como o paciente recebe</p>
              <div className="ml-auto max-w-[260px] rounded-2xl rounded-tr-md bg-primary-soft px-3.5 py-2">
                <p className="break-words text-sm text-foreground whitespace-pre-line">
                  {assinatura && <strong>{nomeDaPrevia}:{"\n"}</strong>}
                  Olá, tudo bem?
                </p>
              </div>
              {assinatura && (
                <p className="mt-2 break-words text-[11px] leading-4 text-muted-foreground">
                  Enviado como <span className="font-mono">{cabecalhoDaAssinatura(nomeDaPrevia)}</span> (negrito no WhatsApp).
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2.5">
            <Button onClick={handleSave} disabled={saving} className="h-11 w-full rounded-xl text-sm font-semibold">
              {saving ? "Salvando..." : "Salvar Alterações"}
            </Button>

            <Button type="button" variant="outline" className="h-11 w-full rounded-xl text-sm font-semibold" onClick={alterarSenha}>
              <KeyRound size={16} className="mr-2" /> Alterar senha
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditProfileDialog;
