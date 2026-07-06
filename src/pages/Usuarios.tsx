import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserPlus, Shield, Users, Pencil, KeyRound, Ban, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import EditProfileDialog from "@/components/EditProfileDialog";
import UserPermissionsSheet from "@/components/usuarios/UserPermissionsSheet";

type Profile = {
  id: string;
  nome: string;
  email: string;
  cargo: string | null;
  avatar_url: string | null;
  created_at: string;
  is_blocked?: boolean | null;
};

type UserRole = {
  user_id: string;
  role: "gerente" | "crc" | "posvenda";
};

const roleLabels: Record<string, string> = {
  gerente: "Gerente",
  crc: "CRC",
  posvenda: "Pós-venda",
};

const roleBadgeClass: Record<string, string> = {
  gerente: "bg-primary/20 text-primary border-primary/30",
  crc: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  posvenda: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};

const Usuarios = () => {
  const { user: currentUser, userRole, refreshProfile } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState("");
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [permsOpen, setPermsOpen] = useState(false);
  const [permsUser, setPermsUser] = useState<Profile | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newNome, setNewNome] = useState("");
  const [newCargo, setNewCargo] = useState("");
  const [newRole, setNewRole] = useState("crc");
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const isAdmin = userRole === "superadmin";

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
      setRoleDialogOpen(false);
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !newNome || !newPassword) { toast.error("Preencha todos os campos"); return; }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("tenant-create-user", {
        body: {
          email: newEmail,
          password: newPassword,
          nome: newNome,
          cargo: newCargo || null,
          role: newRole,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Usuário criado com sucesso! Já pode acessar o sistema.");
      setNewEmail(""); setNewNome(""); setNewCargo(""); setNewPassword(""); setNewRole("crc");
      fetchData();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleEditClick = (profile: Profile) => {
    setEditingUser(profile);
    setEditProfileOpen(true);
  };

  const handleProfileSaved = () => {
    fetchData();
    refreshProfile();
  };

  const getInitials = (name: string) => name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Gestão de Usuários</h1>
          <p className="text-sm text-muted-foreground">Cadastre e gerencie funções dos usuários</p>
        </div>
      </div>

      {/* Create user form - admin only */}
      {isAdmin && (
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
                    <SelectItem value="crc">CRC</SelectItem>
                    <SelectItem value="gerente">Gerente</SelectItem>
                    <SelectItem value="posvenda">Pós-venda</SelectItem>
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
      )}

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
                    <TableHead className="w-12"></TableHead>
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
                    const canEdit = isAdmin || p.id === currentUser?.id;
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={p.avatar_url || undefined} />
                            <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">{getInitials(p.nome)}</AvatarFallback>
                          </Avatar>
                        </TableCell>
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
                          <div className="flex items-center gap-1">
                            {canEdit && (
                              <Button variant="ghost" size="sm" className="text-primary hover:text-primary" onClick={() => handleEditClick(p)}>
                                <Pencil size={14} className="mr-1" /> Editar
                              </Button>
                            )}
                            {isAdmin && (
                              <Dialog open={roleDialogOpen && selectedUserId === p.id} onOpenChange={(o) => { setRoleDialogOpen(o); if (o) { setSelectedUserId(p.id); setSelectedRole(role?.role || "crc"); } }}>
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
                                        <SelectItem value="crc">CRC</SelectItem>
                                        <SelectItem value="gerente">Gerente</SelectItem>
                                        <SelectItem value="posvenda">Pós-venda</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <Button onClick={handleAssignRole} className="w-full gradient-orange text-primary-foreground">Salvar</Button>
                                  </div>
                                </DialogContent>
                              </Dialog>
                            )}
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-primary hover:text-primary"
                                onClick={() => { setPermsUser(p); setPermsOpen(true); }}
                              >
                                <KeyRound size={14} className="mr-1" /> Permissões
                              </Button>
                            )}
                          </div>
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

      {/* Edit profile dialog */}
      {editingUser && (
        <EditProfileDialog
          open={editProfileOpen}
          onOpenChange={setEditProfileOpen}
          userId={editingUser.id}
          currentNome={editingUser.nome}
          currentCargo={editingUser.cargo}
          currentAvatarUrl={editingUser.avatar_url}
          currentEmail={editingUser.email}
          onSaved={handleProfileSaved}
        />
      )}

      {/* Permissions sheet */}
      {permsUser && (
        <UserPermissionsSheet
          open={permsOpen}
          onOpenChange={(o) => { setPermsOpen(o); if (!o) setPermsUser(null); }}
          userId={permsUser.id}
          userName={permsUser.nome}
          userRole={(getUserRole(permsUser.id)?.role as any) || null}
        />
      )}
    </div>
  );
};

export default Usuarios;
