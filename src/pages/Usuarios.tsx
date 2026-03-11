import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { UserPlus, Shield, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Profile = {
  id: string;
  nome: string;
  email: string;
  cargo: string | null;
  created_at: string;
};

type UserRole = {
  user_id: string;
  role: "admin" | "gerente" | "crc";
};

const roleLabels: Record<string, string> = {
  admin: "Administrador",
  gerente: "Gerente",
  crc: "CRC",
};

const roleBadgeClass: Record<string, string> = {
  admin: "bg-red-500/20 text-red-400 border-red-500/30",
  gerente: "bg-primary/20 text-primary border-primary/30",
  crc: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

const Usuarios = () => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newNome, setNewNome] = useState("");
  const [newCargo, setNewCargo] = useState("");
  const [newRole, setNewRole] = useState("crc");
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const [{ data: profs }, { data: rls }] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at"),
      supabase.from("user_roles").select("*"),
    ]);
    setProfiles(profs || []);
    setRoles((rls || []) as UserRole[]);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const getUserRole = (userId: string) => roles.find((r) => r.user_id === userId);

  const handleAssignRole = async () => {
    if (!selectedUserId || !selectedRole) return;
    const existing = getUserRole(selectedUserId);
    try {
      if (existing) {
        const { error } = await supabase.from("user_roles").update({ role: selectedRole as any }).eq("user_id", selectedUserId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("user_roles").insert({ user_id: selectedUserId, role: selectedRole as any });
        if (error) throw error;
      }
      toast.success("Função atualizada!");
      fetchData();
      setDialogOpen(false);
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !newNome || !newPassword) { toast.error("Preencha todos os campos"); return; }
    setCreating(true);
    try {
      // Use edge function or sign up
      const { data, error } = await supabase.auth.signUp({
        email: newEmail,
        password: newPassword,
        options: { data: { nome: newNome } },
      });
      if (error) throw error;
      if (data.user) {
        // Update profile cargo
        await supabase.from("profiles").update({ cargo: newCargo || null }).eq("id", data.user.id);
        // Assign role
        await supabase.from("user_roles").insert({ user_id: data.user.id, role: newRole as any });
      }
      toast.success("Usuário criado! O e-mail de confirmação foi enviado.");
      setNewEmail(""); setNewNome(""); setNewCargo(""); setNewPassword(""); setNewRole("crc");
      fetchData();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Gestão de Usuários</h1>
          <p className="text-sm text-muted-foreground">Cadastre e gerencie funções dos usuários</p>
        </div>
      </div>

      {/* Create user form */}
      <Card className="gradient-card border-border shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus size={18} className="text-primary" />
            Cadastrar Novo Usuário
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateUser} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input placeholder="Nome completo" value={newNome} onChange={(e) => setNewNome(e.target.value)} className="bg-secondary border-border" required />
            </div>
            <div className="space-y-2">
              <Label>E-mail</Label>
              <Input type="email" placeholder="email@exemplo.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="bg-secondary border-border" required />
            </div>
            <div className="space-y-2">
              <Label>Senha</Label>
              <Input type="password" placeholder="Mínimo 6 caracteres" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="bg-secondary border-border" required minLength={6} />
            </div>
            <div className="space-y-2">
              <Label>Cargo</Label>
              <Input placeholder="Ex: Gerente, Recepcionista" value={newCargo} onChange={(e) => setNewCargo(e.target.value)} className="bg-secondary border-border" />
            </div>
            <div className="space-y-2">
              <Label>Função no Sistema</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrador</SelectItem>
                  <SelectItem value="gerente">Gerente</SelectItem>
                  <SelectItem value="crc">CRC</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={creating} className="w-full gradient-orange text-primary-foreground font-semibold shadow-orange hover:opacity-90">
                <UserPlus size={16} className="mr-2" />
                {creating ? "Criando..." : "Criar Usuário"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* User list */}
      <Card className="gradient-card border-border shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users size={18} className="text-primary" />
            Usuários Cadastrados
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Carregando...</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Cargo</TableHead>
                    <TableHead>Função</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.map((p) => {
                    const role = getUserRole(p.id);
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.nome}</TableCell>
                        <TableCell className="text-muted-foreground">{p.email}</TableCell>
                        <TableCell>{p.cargo || "—"}</TableCell>
                        <TableCell>
                          {role ? (
                            <Badge variant="outline" className={roleBadgeClass[role.role]}>
                              {roleLabels[role.role]}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">Sem função</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Dialog open={dialogOpen && selectedUserId === p.id} onOpenChange={(o) => { setDialogOpen(o); if (o) { setSelectedUserId(p.id); setSelectedRole(role?.role || "crc"); } }}>
                            <DialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="text-primary hover:text-primary">
                                <Shield size={14} className="mr-1" /> Função
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Alterar Função — {p.nome}</DialogTitle>
                              </DialogHeader>
                              <div className="space-y-4 pt-4">
                                <Select value={selectedRole} onValueChange={setSelectedRole}>
                                  <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="admin">Administrador</SelectItem>
                                    <SelectItem value="gerente">Gerente</SelectItem>
                                    <SelectItem value="crc">CRC</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Button onClick={handleAssignRole} className="w-full gradient-orange text-primary-foreground">Salvar</Button>
                              </div>
                            </DialogContent>
                          </Dialog>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Usuarios;
