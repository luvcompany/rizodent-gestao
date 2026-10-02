import { useState, useMemo, useEffect } from "react";
import { FILTRO_ORIGENS } from "@/lib/origensLead";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Filter, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DateRangeFilter, type DateRangeFilterValue, getDateRangeFromFilter } from "@/components/ui/date-range-filter";
import { comValorAtual, useCidadesDoTenant, useServicosDoTenant } from "@/hooks/useOpcoesDoTenant";

type Stage = { id: string; name: string; color: string; pipeline_id?: string };
type Profile = { id: string; nome: string };
type Pipeline = { id: string; name: string; is_instagram?: boolean | null };
export const SEM_NUMERO = "__sem_numero__";

export type ConversationFilterValues = {
  pipelineId: string;
  dateFilter: DateRangeFilterValue;
  stageId: string;
  status: string;
  tags: string[];
  source: string;
  assignedTo: string;
  cidade: string;
  servicoInteresse: string;
  hasPagamento: string; // "" | "yes" | "no"
  adAccountId: string;
  adId: string;
  instagramAccountId: string;
  labelIds: string[];
  /**
   * Números de WhatsApp escolhidos (vazio = todos). Opcional: filtros salvos
   * antes dele (localStorage do Kanban) continuam valendo. O filtro só aparece
   * quando quem usa passa `numeros` com mais de um número visível.
   */
  whatsappNumberIds?: string[];
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
  servicoInteresse: "",
  hasPagamento: "",
  adAccountId: "",
  adId: "",
  instagramAccountId: "",
  labelIds: [],
  whatsappNumberIds: [],
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

// Cidades e serviços dos filtros vêm do cadastro do tenant (clinicas.cidade e
// tipos_procedimento ativos) — antes eram listas fixas de uma clínica só.

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
  if (f.servicoInteresse) c++;
  if (f.hasPagamento) c++;
  if (f.adAccountId) c++;
  if (f.adId) c++;
  if (f.instagramAccountId) c++;
  if (f.labelIds?.length) c++;
  if (f.whatsappNumberIds?.length) c++;
  return c;
}

export type InstagramAccountOption = { id: string; username: string };
/** Número de WhatsApp visível para quem filtra (RPC whatsapp_numeros_visiveis). */
export type NumeroOption = { id: string; nome: string; pausado?: boolean };

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
  numeros = [],
  ocultarStatus = false,
  ocultarPagamentos = false,
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
  numeros?: NumeroOption[];
  /** Esconde o campo Status (o Kanban não filtra por status). */
  ocultarStatus?: boolean;
  /** Esconde "Pagamentos vinculados" (papéis que não veem vendas). */
  ocultarPagamentos?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ConversationFilterValues>(filters);
  const [tagSearch, setTagSearch] = useState("");
  const [userLabels, setUserLabels] = useState<{ id: string; name: string; color: string; description: string | null }[]>([]);
  const activeCount = countActive(filters);
  // O filtro já aplicado continua na lista mesmo se saiu do cadastro.
  const cidades = comValorAtual(useCidadesDoTenant(), draft.cidade);
  const servicos = comValorAtual(useServicosDoTenant(), draft.servicoInteresse);

  useEffect(() => {
    if (!open) return;
    supabase.from("crm_user_labels").select("id, name, color, description").order("created_at").then(({ data }) => {
      setUserLabels((data as any) || []);
    });
  }, [open]);

  const handleOpen = () => {
    setDraft(filters);
    setTagSearch("");
    setOpen(true);
  };

  const funilInsta = new Set(pipelines.filter((p) => p.is_instagram).map((p) => p.id));
  const filteredStages = draft.pipelineId
    ? stages.filter((s) => (s as any).pipeline_id === draft.pipelineId)
    : stages.filter((s) => {
        if (!pipelines.length || !s.pipeline_id) return true;
        const ehInsta = funilInsta.has(s.pipeline_id);
        return channel === "instagram" ? ehInsta : !ehInsta;
      });
  const gruposDeEtapas = (() => {
    if (draft.pipelineId) return null;
    const ids = new Set(filteredStages.map((s) => s.pipeline_id).filter(Boolean));
    if (ids.size < 2) return null;
    return pipelines
      .filter((p) => ids.has(p.id))
      .map((p) => ({ funil: p, etapas: filteredStages.filter((s) => s.pipeline_id === p.id) }));
  })();
  const itemDaEtapa = (s: Stage) => (
    <SelectItem key={s.id} value={s.id}>
      <span className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
        {s.name}
      </span>
    </SelectItem>
  );

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
      <Button variant="outline" size="sm" className={cn("relative h-10 shrink-0 gap-1.5 rounded-xl px-2.5 text-xs font-semibold shadow-xs", activeCount > 0 ? "border-primary/40 bg-primary-soft-2 text-primary hover:bg-primary-soft hover:text-primary" : "border-border/60 bg-card")} onClick={handleOpen}>
        <Filter size={15} strokeWidth={1.75} />
        Filtrar
        {activeCount > 0 && (
          <Badge className="pointer-events-none absolute -right-1.5 -top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border-transparent bg-primary px-1 text-[11px] font-bold tabular-nums leading-none text-primary-foreground ring-2 ring-card hover:bg-primary">
            {activeCount}
          </Badge>
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="flex w-[340px] max-w-[92vw] flex-col gap-0 p-0 sm:max-w-[340px]">
          <SheetHeader className="space-y-0 border-b border-border/60 px-5 pb-4 pt-5 text-left">
            <SheetTitle className="flex items-center gap-3 pr-8 text-lg font-bold tracking-tight">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-soft-fg">
                <Filter size={18} strokeWidth={1.75} />
              </span>
              Filtros
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-surface-sunken/60 px-4 py-4">
            <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
            {/* Pipeline (escondido na aba Instagram) */}
            {pipelines.length > 0 && channel !== "instagram" && (
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Funil</label>
                <Select
                  value={draft.pipelineId}
                  onValueChange={(v) => setDraft({ ...draft, pipelineId: v, stageId: "" })}
                >
                  <SelectTrigger className="h-10 rounded-xl text-sm"><SelectValue placeholder="Todos os funis" /></SelectTrigger>
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
                <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Conta de Instagram</label>
                <Select
                  value={draft.instagramAccountId}
                  onValueChange={(v) => setDraft({ ...draft, instagramAccountId: v })}
                >
                  <SelectTrigger className="h-10 rounded-xl text-sm"><SelectValue placeholder="Todas as contas" /></SelectTrigger>
                  <SelectContent>
                    {instagramAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>@{a.username}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Número de WhatsApp (só com mais de um número visível) */}
            {numeros.length > 1 && channel !== "instagram" && (
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Número de WhatsApp</label>
                <div className="flex flex-wrap gap-1.5">
                  {[...numeros, { id: SEM_NUMERO, nome: "Sem número", pausado: false }].map((n) => {
                    const escolhidos = draft.whatsappNumberIds ?? [];
                    const on = escolhidos.includes(n.id);
                    return (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => setDraft({ ...draft, whatsappNumberIds: on ? escolhidos.filter((x) => x !== n.id) : [...escolhidos, n.id] })}
                        className={cn(
                          "inline-flex h-7 max-w-full items-center truncate rounded-full border px-3 text-[11px] font-semibold transition-colors",
                          on ? "border-primary/40 bg-primary-soft-2 text-primary" : "border-border/60 bg-card text-muted-foreground hover:text-foreground",
                        )}
                        title={n.pausado ? `${n.nome} — envio pausado pelo suporte` : n.nome}
                      >
                        {n.nome}{n.pausado ? " · Pausado" : ""}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-tertiary">Mostra só as conversas dos números marcados.</p>
              </div>
            )}

            {/* Stage */}
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Etapa do Funil</label>
              <Select value={draft.stageId} onValueChange={(v) => setDraft({ ...draft, stageId: v })}>
                <SelectTrigger className="h-10 rounded-xl text-sm"><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  {gruposDeEtapas
                    ? gruposDeEtapas.map((g) => (
                        <SelectGroup key={g.funil.id}>
                          <SelectLabel>{g.funil.name}</SelectLabel>
                          {g.etapas.map(itemDaEtapa)}
                        </SelectGroup>
                      ))
                    : filteredStages.map(itemDaEtapa)}
                </SelectContent>
              </Select>
            </div>

            </div>

            <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
            {/* Date */}
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Data</label>
              <div className="[&_button]:h-10 [&_button]:w-full [&_button]:rounded-xl [&_button]:px-3.5 [&_button]:text-sm [&_button]:font-normal [&_button>span]:flex-1 [&_button>span]:text-left">
              <DateRangeFilter
                value={draft.dateFilter}
                onChange={(v) => setDraft({ ...draft, dateFilter: v })}
              />
              </div>
            </div>

            {/* Status */}
            {!ocultarStatus && (
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Status</label>
              <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v })}>
                <SelectTrigger className="h-10 rounded-xl text-sm"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Aberto</SelectItem>
                  <SelectItem value="replied">Respondido</SelectItem>
                  <SelectItem value="no_reply">Sem resposta</SelectItem>
                </SelectContent>
              </Select>
            </div>
            )}

            </div>

            <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
            {/* Cidade */}
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Cidade</label>
              <Select value={draft.cidade} onValueChange={(v) => setDraft({ ...draft, cidade: v })}>
                <SelectTrigger className="h-10 rounded-xl text-sm"><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  {cidades.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Serviço de Interesse */}
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Serviço de Interesse</label>
              <Select value={draft.servicoInteresse} onValueChange={(v) => setDraft({ ...draft, servicoInteresse: v })}>
                <SelectTrigger className="h-10 rounded-xl text-sm"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  {servicos.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>


            {/* Pagamentos vinculados */}
            {!ocultarPagamentos && (
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Pagamentos vinculados</label>
              <Select value={draft.hasPagamento} onValueChange={(v) => setDraft({ ...draft, hasPagamento: v })}>
                <SelectTrigger className="h-10 rounded-xl text-sm"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Com pagamento</SelectItem>
                  <SelectItem value="no">Sem pagamento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            )}

            </div>

            <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
            {/* Marcadores de cor (pessoais) */}
            {userLabels.length > 0 && (
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Marcadores</label>
                <div className="flex flex-wrap gap-1.5">
                  {userLabels.map((l) => {
                    const on = draft.labelIds.includes(l.id);
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => setDraft({ ...draft, labelIds: on ? draft.labelIds.filter(x => x !== l.id) : [...draft.labelIds, l.id] })}
                        className={`inline-flex h-7 max-w-full items-center rounded-full px-3 text-[11px] font-semibold text-white transition-all ${on ? "ring-2 ring-foreground/70 ring-offset-2 ring-offset-card" : "opacity-75 hover:opacity-100"}`}
                        style={{ backgroundColor: l.color }}
                        title={l.description || l.name}
                      >
                        {l.name}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-tertiary">Filtra leads que tenham qualquer um dos marcadores selecionados.</p>
              </div>
            )}

            {/* Tags - autocomplete */}
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Tags</label>
              {draft.tags.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {draft.tags.map((t) => (
                    <Badge key={t} variant="default" className="h-7 max-w-full gap-1 rounded-full border-transparent px-3 pr-1.5 text-xs font-medium [overflow-wrap:anywhere]">
                      {t}
                      <button onClick={() => removeTag(t)} className="grid h-5 w-5 shrink-0 place-items-center rounded-full hover:bg-primary-foreground/20">
                        <X size={12} strokeWidth={1.75} />
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
                  className="h-10 rounded-xl text-sm"
                />
                {matchingTags.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-40 overflow-y-auto rounded-xl border border-border/60 bg-card p-1 shadow-float">
                    {matchingTags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => addTag(tag)}
                        className="w-full rounded-lg px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-sunken"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {allTags.length === 0 && <span className="mt-1.5 block text-xs text-tertiary">Sem tags</span>}
            </div>

            </div>

            <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
            {/* Source */}
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Fonte/Integração</label>
              <Select value={draft.source} onValueChange={(v) => setDraft({ ...draft, source: v })}>
                <SelectTrigger className="h-10 rounded-xl text-sm"><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  {FILTRO_ORIGENS.map((o) => (
                    <SelectItem key={o.valor} value={o.valor}>{o.rotulo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Conta de anúncio (escondido na aba Instagram) */}
            {adAccounts.length > 0 && channel !== "instagram" && (
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Conta de anúncio</label>
                <Select
                  value={draft.adAccountId}
                  onValueChange={(v) => setDraft({ ...draft, adAccountId: v, adId: "" })}
                >
                  <SelectTrigger className="h-10 rounded-xl text-sm"><SelectValue placeholder="Todas" /></SelectTrigger>
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
                <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Anúncio</label>
                <Select value={draft.adId} onValueChange={(v) => setDraft({ ...draft, adId: v })}>
                  <SelectTrigger className="h-10 rounded-xl text-sm"><SelectValue placeholder="Todos" /></SelectTrigger>
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
                      className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
                    >
                      Ver anúncio ↗
                    </a>
                  );
                })()}
              </div>
            )}

            </div>

            <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
            {/* Assigned */}
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Responsável</label>
              <Select value={draft.assignedTo} onValueChange={(v) => setDraft({ ...draft, assignedTo: v })}>
                <SelectTrigger className="h-10 rounded-xl text-sm"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            </div>
          </div>
          <div className="flex gap-2 border-t border-border/60 bg-card px-5 py-4">
            <Button size="sm" className="h-10 flex-1 rounded-xl text-sm font-semibold" onClick={() => { onApply(draft); setOpen(false); }}>
              Aplicar filtros
            </Button>
            <Button size="sm" variant="outline" className="h-10 rounded-xl px-4 text-sm font-medium" onClick={() => { onApply(emptyFilters); setOpen(false); }}>
              Limpar
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export { emptyFilters, countActive, getDateRangeFromFilter };
