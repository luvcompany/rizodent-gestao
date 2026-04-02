// Bot Builder Types

export type BotStatus = 'draft' | 'published' | 'archived';

export type Bot = {
  id: string;
  name: string;
  description: string | null;
  status: BotStatus;
  flow_json: FlowData;
  current_version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FlowData = {
  nodes: BotFlowNode[];
  edges: BotFlowEdge[];
};

export type BotFlowNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, any>;
};

export type BotFlowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
  style?: Record<string, any>;
  type?: string;
  animated?: boolean;
};

// Node categories and definitions
export type NodeCategory = 'start' | 'message' | 'logic' | 'action' | 'control';

export type NodeDefinition = {
  type: string;
  label: string;
  icon: string;
  category: NodeCategory;
  color: string;
  description: string;
  defaultData: Record<string, any>;
};

export const NODE_DEFINITIONS: NodeDefinition[] = [
  // Start
  { type: 'start', label: 'Início', icon: '▶️', category: 'start', color: '#22c55e', description: 'Ponto de início do fluxo', defaultData: {} },
  // Messages (only 4)
  { type: 'send_text', label: 'Mensagem de Texto', icon: '💬', category: 'message', color: '#3b82f6', description: 'Envia texto ou modelo de WhatsApp', defaultData: { text: '', templateId: '', templateButtons: [], timeoutHours: 1, timeoutMinutes: 0, timeoutSeconds: 0 } },
  { type: 'send_audio', label: 'Áudio', icon: '🎙️', category: 'message', color: '#3b82f6', description: 'Grava e envia áudio de voz', defaultData: { audioUrl: '' } },
  { type: 'send_file', label: 'Arquivo / Mídia', icon: '📎', category: 'message', color: '#3b82f6', description: 'Envia foto, vídeo ou documento com texto', defaultData: { fileUrl: '', fileType: 'image', caption: '' } },
  { type: 'send_menu', label: 'Menu Interativo', icon: '📋', category: 'message', color: '#3b82f6', description: 'Lista ou botões clicáveis via WhatsApp API', defaultData: { menuType: 'buttons', headerText: '', bodyText: '', footerText: '', buttons: [{ id: '1', title: 'Opção 1' }], listSections: [{ title: 'Seção 1', rows: [{ id: '1', title: 'Item 1', description: '' }] }], buttonLabel: 'Menu', noResponseTimeoutMinutes: 60 } },
  // Logic
  { type: 'delay', label: 'Pausa / Delay', icon: '⏸️', category: 'logic', color: '#a855f7', description: 'Aguarda um tempo antes de continuar', defaultData: { delaySeconds: 5, unit: 'seconds' } },
  { type: 'wait_reply', label: 'Aguardar Resposta', icon: '⌛', category: 'logic', color: '#a855f7', description: 'Aguarda resposta do cliente', defaultData: { timeoutHours: 1, timeoutMinutes: 0, timeoutSeconds: 0, saveToField: '' } },
  { type: 'condition', label: 'Condição (If/Else)', icon: '🔀', category: 'logic', color: '#a855f7', description: 'Ramifica baseado em condições', defaultData: { field: '', operator: 'equals', value: '' } },
  { type: 'schedule', label: 'Programar Envio', icon: '📅', category: 'logic', color: '#a855f7', description: 'Programa mensagem para data/hora futura', defaultData: { scheduleMode: 'next_day', scheduleTime: '09:00', scheduleDate: '', messageType: 'text', text: '', audioUrl: '', fileUrl: '', fileType: 'image', caption: '' } },
  // Actions
  { type: 'move_stage', label: 'Mudar Etapa', icon: '📌', category: 'action', color: '#10b981', description: 'Move o lead para outra etapa', defaultData: { stageId: '' } },
  { type: 'add_tag', label: 'Adicionar Tag', icon: '🏷️', category: 'action', color: '#10b981', description: 'Adiciona tag ao lead', defaultData: { tag: '' } },
  { type: 'remove_tag', label: 'Remover Tag', icon: '🏷️', category: 'action', color: '#10b981', description: 'Remove tag do lead', defaultData: { tag: '' } },
  { type: 'add_note', label: 'Adicionar Nota', icon: '📝', category: 'action', color: '#10b981', description: 'Insere nota no histórico', defaultData: { note: '' } },
  { type: 'create_task', label: 'Criar Tarefa', icon: '✅', category: 'action', color: '#10b981', description: 'Cria tarefa para o lead', defaultData: { title: '', dueHours: 24 } },
  // Control
  { type: 'transfer_human', label: 'Transferir para Humano', icon: '👤', category: 'control', color: '#f59e0b', description: 'Encerra bot e notifica operador', defaultData: {} },
];

export const CATEGORY_LABELS: Record<NodeCategory, string> = {
  start: 'Início',
  message: 'Mensagens',
  logic: 'Lógica',
  action: 'Ações CRM',
  control: 'Controle',
};

// Lead variables for use in message templates
export const LEAD_VARIABLES = [
  { key: 'lead.nome', label: 'Nome do Lead', example: 'João Silva' },
  { key: 'lead.telefone', label: 'Telefone', example: '11999999999' },
  { key: 'lead.origem', label: 'Origem', example: 'Facebook Ads' },
  { key: 'lead.etapa', label: 'Etapa Atual', example: 'Agendamento' },
  { key: 'lead.tags', label: 'Tags', example: 'VIP, Interessado' },
  { key: 'lead.valor', label: 'Valor', example: '1500' },
  { key: 'lead.notas', label: 'Notas', example: 'Prefere atendimento...' },
  { key: 'lead.ultima_mensagem', label: 'Última Mensagem', example: 'Olá, gostaria...' },
  { key: 'lead.criado_em', label: 'Data de Criação', example: '01/04/2026' },
  { key: 'lead.nome_anuncio', label: 'Nome do Anúncio', example: 'Campanha Verão' },
  { key: 'lead.titulo_anuncio', label: 'Título do Anúncio', example: 'Oferta Especial' },
  { key: 'lead.follow_up_count', label: 'Nº Follow-ups', example: '3' },
];
