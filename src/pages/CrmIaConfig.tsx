import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Save, Loader2, Bot, MessageSquare, Wand2, Clock, ShieldCheck, GraduationCap } from "lucide-react";
import AiRulesManager from "@/components/ai/AiRulesManager";
import AiLearningReport from "@/components/ai/AiLearningReport";
import { toast } from "sonner";

const MODELS = [
  { value: "google/gemini-3-flash-preview", label: "Gemini 3 Flash (rápido, padrão)" },
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (equilibrado)" },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (mais preciso)" },
  { value: "openai/gpt-5-mini", label: "GPT-5 Mini" },
  { value: "openai/gpt-5", label: "GPT-5 (mais avançado)" },
  { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Anthropic)" },
  { value: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5 (Anthropic)" },
];

const TRANSCRIPTION_MODELS = [
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (padrão, via Lovable AI)" },
  { value: "openai/whisper-1", label: "OpenAI Whisper-1 (sua chave OPENAI_API_KEY)" },
  { value: "openai/gpt-4o-mini-transcribe", label: "OpenAI gpt-4o-mini-transcribe (sua chave)" },
  { value: "openai/gpt-4o-transcribe", label: "OpenAI gpt-4o-transcribe (sua chave, + preciso)" },
];

const TONES = [
  "profissional e acolhedor",
  "informal e amigável",
  "formal e objetivo",
  "consultivo e empático",
];

type Config = {
  id: string;
  name: string;
  model: string;
  system_prompt: string;
  tone: string;
  language: string;
  custom_instructions: string;
  enabled_features: { summary?: boolean; suggestions?: boolean; auto_reply?: boolean };
  is_active: boolean;
  assistant_display_name?: string;
  knowledge_base?: string;
  copilot_enabled?: boolean;
  auto_send_enabled?: boolean;
  shift_start?: string;
  shift_end?: string;
  wait_minutes?: number;
  recoil_hours?: number;
  transcription_model?: string;
};

export default function CrmIaConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("ai_assistant_config" as any)
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        toast.error("Erro ao carregar configuração da IA");
      } else {
        setConfig(data as any);
      }
      setLoading(false);
    })();
  }, []);

  const update = (patch: Partial<Config>) => setConfig((c) => (c ? { ...c, ...patch } : c));

  const save = async () => {
    if (!config) return;
    setSaving(true);
    const { error } = await supabase
      .from("ai_assistant_config" as any)
      .update({
        name: config.name,
        model: config.model,
        system_prompt: config.system_prompt,
        tone: config.tone,
        language: config.language,
        custom_instructions: config.custom_instructions,
        enabled_features: config.enabled_features,
        is_active: config.is_active,
        assistant_display_name: config.assistant_display_name || "Bia",
        knowledge_base: config.knowledge_base || null,
        copilot_enabled: !!config.copilot_enabled,
        auto_send_enabled: !!config.auto_send_enabled,
        shift_start: config.shift_start || "07:29",
        shift_end: config.shift_end || "14:00",
        wait_minutes: Number(config.wait_minutes) || 10,
        recoil_hours: Number(config.recoil_hours) || 2,
        transcription_model: config.transcription_model || "google/gemini-2.5-flash",
      })
      .eq("id", config.id);
    setSaving(false);
    if (error) toast.error("Erro ao salvar: " + error.message);
    else toast.success("Configurações da IA salvas!");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 size={16} className="animate-spin" /> Carregando...
      </div>
    );
  }

  if (!config) {
    return (
      <div className="text-center text-muted-foreground py-12">
        Nenhuma configuração encontrada. Recarregue a página.
      </div>
    );
  }

  const features = config.enabled_features || {};

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Sparkles className="text-primary" size={22} />
            Configurações da I.A
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure como o assistente de IA analisa e sugere respostas para os atendimentos.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch checked={config.is_active} onCheckedChange={(v) => update({ is_active: v })} />
            <Label className="text-sm">{config.is_active ? "Ativa" : "Inativa"}</Label>
          </div>
          <Button onClick={save} disabled={saving} className="gradient-orange text-primary-foreground">
            {saving ? <Loader2 size={14} className="animate-spin mr-2" /> : <Save size={14} className="mr-2" />}
            Salvar
          </Button>
        </div>
      </div>

      <Tabs defaultValue="bia">
        <TabsList className="grid grid-cols-7 w-full max-w-5xl">
          <TabsTrigger value="bia" className="gap-2"><Sparkles size={14} />Bia</TabsTrigger>
          <TabsTrigger value="orientacoes" className="gap-2"><ShieldCheck size={14} />Orientações</TabsTrigger>
          <TabsTrigger value="aprendizado" className="gap-2"><GraduationCap size={14} />Aprendizado</TabsTrigger>
          <TabsTrigger value="comportamento" className="gap-2"><Bot size={14} />Comportamento</TabsTrigger>
          <TabsTrigger value="instrucoes" className="gap-2"><Wand2 size={14} />Instruções</TabsTrigger>
          <TabsTrigger value="funcoes" className="gap-2"><MessageSquare size={14} />Funções</TabsTrigger>
          <TabsTrigger value="agenda" className="gap-2"><Clock size={14} />Atendimento</TabsTrigger>
        </TabsList>

        {/* BIA / COPILOTO */}
        <TabsContent value="bia" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Sparkles size={16} className="text-primary" />Atendente IA "Bia"</CardTitle>
              <CardDescription>
                Configure a atendente virtual que sugere respostas no WhatsApp. Comece com o copiloto LIGADO e o auto-envio DESLIGADO até validar a qualidade.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome da assistente</Label>
                  <Input
                    value={config.assistant_display_name || ""}
                    onChange={(e) => update({ assistant_display_name: e.target.value })}
                    placeholder="Bia"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Modelo de IA</Label>
                  <Select value={config.model} onValueChange={(v) => update({ model: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MODELS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Modelos Anthropic exigem a secret <code>ANTHROPIC_API_KEY</code> configurada no backend.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Modelo de transcrição de áudio</Label>
                <Select
                  value={config.transcription_model || "google/gemini-2.5-flash"}
                  onValueChange={(v) => update({ transcription_model: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TRANSCRIPTION_MODELS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Modelos OpenAI usam a secret <code>OPENAI_API_KEY</code> configurada no backend (cobrada na sua conta OpenAI). O Gemini usa créditos da Lovable AI.
                </p>
              </div>


              <ToggleRow
                title="Copiloto (sugestões com aprovação humana)"
                desc="A Bia gera sugestões de resposta e o atendente aprova (✓) ou descarta (✗) antes do envio."
                checked={!!config.copilot_enabled}
                onChange={(v) => update({ copilot_enabled: v })}
              />
              <ToggleRow
                title="Auto-envio (cuidado!)"
                desc="A Bia envia automaticamente as sugestões pendentes respeitando o turno da SDR, a janela de 24h e as regras de convivência. Deixe DESLIGADO até validar tudo no modo copiloto."
                checked={!!config.auto_send_enabled}
                onChange={(v) => update({ auto_send_enabled: v })}
              />

              <div className="grid sm:grid-cols-2 gap-4 pt-2">
                <div className="space-y-2">
                  <Label>Início do turno da SDR (Bahia, UTC-3)</Label>
                  <Input type="time" value={config.shift_start || "07:29"} onChange={(e) => update({ shift_start: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Fim do turno da SDR</Label>
                  <Input type="time" value={config.shift_end || "14:00"} onChange={(e) => update({ shift_end: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Tempo de espera após inbound (minutos)</Label>
                  <Input
                    type="number" min={1} max={240}
                    value={config.wait_minutes ?? 10}
                    onChange={(e) => update({ wait_minutes: parseInt(e.target.value || "10", 10) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Janela de recuo após resposta humana (horas)</Label>
                  <Input
                    type="number" min={0} max={48}
                    value={config.recoil_hours ?? 2}
                    onChange={(e) => update({ recoil_hours: parseInt(e.target.value || "2", 10) })}
                  />
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <Label>Base de Conhecimento da Bia</Label>
                <Textarea
                  value={config.knowledge_base || ""}
                  onChange={(e) => update({ knowledge_base: e.target.value })}
                  className="min-h-[260px] font-mono text-xs"
                  placeholder="Persona, regras de ouro, respostas-padrão, faixas de preço, endereços das unidades..."
                />
                <p className="text-[11px] text-muted-foreground">
                  Este texto é injetado no prompt da IA em toda sugestão. Se ficar vazio, será usada a base padrão da Rizodent.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ORIENTAÇÕES (Diretrizes × Restrições) */}
        <TabsContent value="orientacoes" className="space-y-4 mt-4">
          <AiRulesManager />
        </TabsContent>

        {/* APRENDIZADO (feedback dataset) */}
        <TabsContent value="aprendizado" className="space-y-4 mt-4">
          <AiLearningReport />
        </TabsContent>

        {/* COMPORTAMENTO */}
        <TabsContent value="comportamento" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Identidade e modelo</CardTitle>
              <CardDescription>Defina o nome, o modelo de linguagem e o tom de voz do assistente.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome do assistente</Label>
                  <Input value={config.name} onChange={(e) => update({ name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Idioma</Label>
                  <Input value={config.language} onChange={(e) => update({ language: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Modelo</Label>
                  <Select value={config.model} onValueChange={(v) => update({ model: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MODELS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Tom de voz</Label>
                  <Select value={config.tone} onValueChange={(v) => update({ tone: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* INSTRUÇÕES */}
        <TabsContent value="instrucoes" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Instruções da IA (System Prompt)</CardTitle>
              <CardDescription>
                Estas instruções são aplicadas nas análises e também nas sugestões de resposta da Bia. Descreva o
                contexto da clínica, regras de atendimento, produtos/serviços e o que a IA deve evitar. Elas
                complementam a base — sem substituir as regras de segurança e anti-alucinação, nem as Restrições.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Prompt principal</Label>
                <Textarea
                  value={config.system_prompt}
                  onChange={(e) => update({ system_prompt: e.target.value })}
                  className="min-h-[180px] font-mono text-xs"
                />
              </div>
              <div className="space-y-2">
                <Label>Instruções adicionais</Label>
                <Textarea
                  value={config.custom_instructions || ""}
                  onChange={(e) => update({ custom_instructions: e.target.value })}
                  placeholder="Ex: Nunca prometa preços. Sempre sugira agendar avaliação. Priorize cidades de atendimento da Rizodent."
                  className="min-h-[140px]"
                />
                <p className="text-xs text-muted-foreground">
                  Use este campo para complementar o prompt principal sem alterar a base.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* FUNÇÕES */}
        <TabsContent value="funcoes" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Funções da IA</CardTitle>
              <CardDescription>Habilite ou desabilite cada capacidade do assistente.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleRow
                title="Resumo de conversas"
                desc="Permite que a IA gere um resumo objetivo do histórico do atendimento."
                checked={!!features.summary}
                onChange={(v) => update({ enabled_features: { ...features, summary: v } })}
              />
              <ToggleRow
                title="Sugestões de atendimento"
                desc="Gera sugestões de mensagens prontas para o atendente humano enviar."
                checked={!!features.suggestions}
                onChange={(v) => update({ enabled_features: { ...features, suggestions: v } })}
              />
              <ToggleRow
                title="Resposta automática (em breve)"
                desc="Permitirá que a IA responda diretamente os leads em horários configurados, com base no padrão dos atendentes humanos."
                checked={!!features.auto_reply}
                onChange={(v) => update({ enabled_features: { ...features, auto_reply: v } })}
                disabled
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* AGENDA / FUTURO */}
        <TabsContent value="agenda" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Clock size={16} />Atendimento automático (em desenvolvimento)</CardTitle>
              <CardDescription>
                Em breve será possível configurar horários em que a IA atende automaticamente os leads, seguindo o
                mesmo padrão dos atendentes humanos. Por enquanto, a IA está aprendendo com o histórico das conversas
                analisadas nas abas Conversas e CRM Conversa.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground text-center">
                Funcionalidade planejada — a IA começará a operar de forma autônoma após coletar dados suficientes
                sobre o estilo e a lógica dos atendimentos atuais.
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ToggleRow({
  title,
  desc,
  checked,
  onChange,
  disabled,
}: { title: string; desc: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-border bg-secondary/30">
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
