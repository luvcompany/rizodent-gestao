import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Filter, X } from "lucide-react";
import { DateRangeFilter, type DateRangeFilterValue, getDateRangeFromFilter } from "@/components/ui/date-range-filter";

type Stage = { id: string; name: string; color: string; pipeline_id?: string };
type Profile = { id: string; nome: string };
type Pipeline = { id: string; name: string };

export type ConversationFilterValues = {
  pipelineId: string;
  dateFilter: DateRangeFilterValue;
  stageId: string;
  status: string;
  tags: string[];
  source: string;
  assignedTo: string;
};

const emptyFilters: ConversationFilterValues = {
  pipelineId: "",
  dateFilter: { preset: "all" },
  stageId: "",
  status: "",
  tags: [],
  source: "",
  assignedTo: "",
};

function countActive(f: ConversationFilterValues): number {
  let c = 0;
  if (f.pipelineId) c++;
  if (f.dateFilter.preset !== "all") c++;
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
  pipelines = [],
}: {
  stages: Stage[];
  profiles: Profile[];
  allTags: string[];
  filters: ConversationFilterValues;
  onApply: (f: ConversationFilterValues) => void;
  pipelines?: Pipeline[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ConversationFilterValues>(filters);
  const activeCount = countActive(filters);

  const handleOpen = () => {
    setDraft(filters);
    setOpen(true);
  };

  const filteredStages = draft.pipelineId
    ? stages.filter((s) => (s as any).pipeline_id === draft.pipelineId)
    : stages;

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
          <div className="mt-4 space-y-4 overflow-y-auto max-h-[calc(100vh-120px)]">
            {/* Pipeline */}
            {pipelines.length > 0 && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Funil</label>
                <Select
                  value={draft.pipelineId}
                  onValueChange={(v) => setDraft({ ...draft, pipelineId: v, stageId: "" })}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos os funis" /></SelectTrigger>
                  <SelectContent>
                    {pipelines.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Stage */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Etapa do Funil</label>
              <Select value={draft.stageId} onValueChange={(v) => setDraft({ ...draft, stageId: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  {filteredStages.map((s) => (
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

            {/* Date */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Data</label>
              <DateRangeFilter
                value={draft.dateFilter}
                onChange={(v) => setDraft({ ...draft, dateFilter: v })}
              />
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
                  <SelectItem value="anuncio">Anúncio</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="facebook">Facebook</SelectItem>
                  <SelectItem value="site">Site</SelectItem>
                  <SelectItem value="indicacao">Indicação</SelectItem>
                  <SelectItem value="organico">Orgânico</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
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

export { emptyFilters, countActive, getDateRangeFromFilter };
