import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CalendarIcon, Filter, X } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

type Stage = { id: string; name: string; color: string };
type Profile = { id: string; nome: string };

export type ConversationFilterValues = {
  dateRange: string;
  customDateFrom?: Date;
  customDateTo?: Date;
  stageId: string;
  status: string;
  tags: string[];
  source: string;
  assignedTo: string;
};

const emptyFilters: ConversationFilterValues = {
  dateRange: "",
  stageId: "",
  status: "",
  tags: [],
  source: "",
  assignedTo: "",
};

function countActive(f: ConversationFilterValues): number {
  let c = 0;
  if (f.dateRange) c++;
  if (f.stageId) c++;
  if (f.status) c++;
  if (f.tags.length) c++;
  if (f.source) c++;
  if (f.assignedTo) c++;
  return c;
}

export default function ConversationFilters({
  stages,
  profiles,
  allTags,
  filters,
  onApply,
}: {
  stages: Stage[];
  profiles: Profile[];
  allTags: string[];
  filters: ConversationFilterValues;
  onApply: (f: ConversationFilterValues) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ConversationFilterValues>(filters);
  const activeCount = countActive(filters);

  const handleOpen = () => {
    setDraft(filters);
    setOpen(true);
  };

  return (
    <>
      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleOpen}>
        <Filter size={14} />
        Filtrar
        {activeCount > 0 && (
          <Badge className="ml-1 h-4 w-4 p-0 flex items-center justify-center text-[10px] bg-primary text-primary-foreground">
            {activeCount}
          </Badge>
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[320px] sm:max-w-[320px]">
          <SheetHeader>
            <SheetTitle>Filtros</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            {/* Date */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Data</label>
              <Select value={draft.dateRange} onValueChange={(v) => setDraft({ ...draft, dateRange: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Qualquer hora" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Hoje</SelectItem>
                  <SelectItem value="yesterday">Ontem</SelectItem>
                  <SelectItem value="7days">Últimos 7 dias</SelectItem>
                  <SelectItem value="custom">Personalizado</SelectItem>
                </SelectContent>
              </Select>
              {draft.dateRange === "custom" && (
                <div className="flex gap-2 mt-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className={cn("h-8 text-xs flex-1", !draft.customDateFrom && "text-muted-foreground")}>
                        <CalendarIcon size={12} className="mr-1" />
                        {draft.customDateFrom ? format(draft.customDateFrom, "dd/MM/yy") : "De"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={draft.customDateFrom} onSelect={(d) => setDraft({ ...draft, customDateFrom: d || undefined })} className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className={cn("h-8 text-xs flex-1", !draft.customDateTo && "text-muted-foreground")}>
                        <CalendarIcon size={12} className="mr-1" />
                        {draft.customDateTo ? format(draft.customDateTo, "dd/MM/yy") : "Até"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={draft.customDateTo} onSelect={(d) => setDraft({ ...draft, customDateTo: d || undefined })} className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>

            {/* Stage */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Etapa do Funil</label>
              <Select value={draft.stageId} onValueChange={(v) => setDraft({ ...draft, stageId: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                        {s.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
              <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Aberto</SelectItem>
                  <SelectItem value="replied">Respondido</SelectItem>
                  <SelectItem value="no_reply">Sem resposta</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Tags */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Tags</label>
              <div className="flex flex-wrap gap-1">
                {allTags.map((t) => (
                  <Badge
                    key={t}
                    variant={draft.tags.includes(t) ? "default" : "outline"}
                    className="cursor-pointer text-[10px]"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        tags: draft.tags.includes(t) ? draft.tags.filter((x) => x !== t) : [...draft.tags, t],
                      })
                    }
                  >
                    {t}
                  </Badge>
                ))}
                {allTags.length === 0 && <span className="text-xs text-muted-foreground">Sem tags</span>}
              </div>
            </div>

            {/* Source */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Fonte/Integração</label>
              <Select value={draft.source} onValueChange={(v) => setDraft({ ...draft, source: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="facebook">Facebook</SelectItem>
                  <SelectItem value="site">Site</SelectItem>
                  <SelectItem value="indicacao">Indicação</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Assigned */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Responsável</label>
              <Select value={draft.assignedTo} onValueChange={(v) => setDraft({ ...draft, assignedTo: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2 pt-2">
              <Button size="sm" className="flex-1" onClick={() => { onApply(draft); setOpen(false); }}>
                Aplicar filtros
              </Button>
              <Button size="sm" variant="outline" onClick={() => { onApply(emptyFilters); setOpen(false); }}>
                Limpar
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export { emptyFilters, countActive };
