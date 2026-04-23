import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  cidade: string;
  hasPagamento: string; // "" | "yes" | "no"
};

const emptyFilters: ConversationFilterValues = {
  pipelineId: "",
  dateFilter: { preset: "all" },
  stageId: "",
  status: "",
  tags: [],
  source: "",
  assignedTo: "",
  cidade: "",
  hasPagamento: "",
};

const CIDADES = [
  "Vitória da Conquista",
  "Guanambi",
  "Ipiaú",
  "Itabuna",
];

function countActive(f: ConversationFilterValues): number {
  let c = 0;
  if (f.pipelineId) c++;
  if (f.dateFilter.preset !== "all") c++;
  if (f.stageId) c++;
  if (f.status) c++;
  if (f.tags.length) c++;
  if (f.source) c++;
  if (f.assignedTo) c++;
  if (f.cidade) c++;
  if (f.hasPagamento) c++;
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
  const [tagSearch, setTagSearch] = useState("");
  const activeCount = countActive(filters);

  const handleOpen = () => {
    setDraft(filters);
    setTagSearch("");
    setOpen(true);
  };

  const filteredStages = draft.pipelineId
    ? stages.filter((s) => (s as any).pipeline_id === draft.pipelineId)
    : stages;

  const matchingTags = useMemo(() => {
    if (!tagSearch.trim()) return [];
    const q = tagSearch.toLowerCase();
    return allTags.filter((t) => t.toLowerCase().includes(q) && !draft.tags.includes(t)).slice(0, 10);
  }, [tagSearch, allTags, draft.tags]);

  const removeTag = (tag: string) => {
    setDraft({ ...draft, tags: draft.tags.filter((t) => t !== tag) });
  };

  const addTag = (tag: string) => {
    setDraft({ ...draft, tags: [...draft.tags, tag] });
    setTagSearch("");
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

            {/* Cidade */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Cidade</label>
              <Select value={draft.cidade} onValueChange={(v) => setDraft({ ...draft, cidade: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  {CIDADES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tags - autocomplete */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Tags</label>
              {draft.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {draft.tags.map((t) => (
                    <Badge key={t} variant="default" className="text-[10px] gap-1 pr-1">
                      {t}
                      <button onClick={() => removeTag(t)} className="ml-0.5 hover:text-destructive-foreground">
                        <X size={10} />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="relative">
                <Input
                  placeholder="Digitar nome da tag..."
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  className="h-8 text-xs"
                />
                {matchingTags.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-card border border-border rounded-md shadow-lg max-h-32 overflow-y-auto">
                    {matchingTags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => addTag(tag)}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-secondary transition-colors"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {allTags.length === 0 && <span className="text-xs text-muted-foreground">Sem tags</span>}
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
