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
  adAccountId: string;
  adId: string;
  instagramAccountId: string;
  labelIds: string[];
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
  adAccountId: "",
  adId: "",
  instagramAccountId: "",
  labelIds: [],
};

export type AdAccountOption = { id: string; name: string };
export type AdOption = {
  id: string;
  name: string;
  ad_account_id?: string | null;
  image?: string | null;
  description?: string | null;
  link?: string | null;
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
  if (f.adAccountId) c++;
  if (f.adId) c++;
  if (f.instagramAccountId) c++;
  return c;
}

export type InstagramAccountOption = { id: string; username: string };

export default function ConversationFilters({
  stages,
  profiles,
  allTags,
  filters,
  onApply,
  pipelines = [],
  adAccounts = [],
  ads = [],
  channel = "whatsapp",
  instagramAccounts = [],
}: {
  stages: Stage[];
  profiles: Profile[];
  allTags: string[];
  filters: ConversationFilterValues;
  onApply: (f: ConversationFilterValues) => void;
  pipelines?: Pipeline[];
  adAccounts?: AdAccountOption[];
  ads?: AdOption[];
  channel?: "whatsapp" | "instagram";
  instagramAccounts?: InstagramAccountOption[];
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

  const filteredAds = useMemo(() => {
    const base = !draft.adAccountId ? ads : ads.filter((a) => a.ad_account_id === draft.adAccountId);
    // Ads with images first, then ads without; preserve relative order otherwise
    return [...base].sort((a, b) => {
      const ai = a.image ? 1 : 0;
      const bi = b.image ? 1 : 0;
      return bi - ai;
    });
  }, [ads, draft.adAccountId]);

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
            {/* Pipeline (escondido na aba Instagram) */}
            {pipelines.length > 0 && channel !== "instagram" && (
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

            {/* Conta de Instagram (apenas na aba Instagram) */}
            {channel === "instagram" && instagramAccounts.length > 0 && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Conta de Instagram</label>
                <Select
                  value={draft.instagramAccountId}
                  onValueChange={(v) => setDraft({ ...draft, instagramAccountId: v })}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas as contas" /></SelectTrigger>
                  <SelectContent>
                    {instagramAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>@{a.username}</SelectItem>
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

            {/* Pagamentos vinculados */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Pagamentos vinculados</label>
              <Select value={draft.hasPagamento} onValueChange={(v) => setDraft({ ...draft, hasPagamento: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Com pagamento</SelectItem>
                  <SelectItem value="no">Sem pagamento</SelectItem>
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

            {/* Conta de anúncio (escondido na aba Instagram) */}
            {adAccounts.length > 0 && channel !== "instagram" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Conta de anúncio</label>
                <Select
                  value={draft.adAccountId}
                  onValueChange={(v) => setDraft({ ...draft, adAccountId: v, adId: "" })}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent>
                    {adAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Anúncio específico (escondido na aba Instagram) */}
            {ads.length > 0 && channel !== "instagram" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Anúncio</label>
                <Select value={draft.adId} onValueChange={(v) => setDraft({ ...draft, adId: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent className="max-h-[400px] w-[300px]">
                    {filteredAds.map((a) => (
                      <SelectItem key={a.id} value={a.id} className="py-2 pr-2">
                        <div className="flex gap-2 items-center w-[260px]">
                          {a.image ? (
                            <img
                              src={a.image}
                              alt=""
                              className="w-10 h-10 rounded object-cover flex-shrink-0 border border-border bg-muted"
                              onError={(e) => {
                                const t = e.target as HTMLImageElement;
                                t.style.visibility = "hidden";
                              }}
                            />
                          ) : (
                            <div className="w-10 h-10 rounded bg-muted flex-shrink-0 flex items-center justify-center text-[9px] text-muted-foreground/60">
                              s/ img
                            </div>
                          )}
                          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                            <span className="text-xs font-medium truncate leading-tight">{a.name}</span>
                            {a.description && (
                              <span className="text-[10px] text-muted-foreground line-clamp-1 leading-tight">{a.description}</span>
                            )}
                            <span className="text-[9px] text-muted-foreground/70 truncate leading-tight">ID: {a.id}</span>
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {draft.adId && (() => {
                  const sel = filteredAds.find((a) => a.id === draft.adId);
                  if (!sel?.link) return null;
                  return (
                    <a
                      href={sel.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-primary hover:underline mt-1 inline-block"
                    >
                      Ver anúncio ↗
                    </a>
                  );
                })()}
              </div>
            )}

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
