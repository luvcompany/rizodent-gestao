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
  // Messages
  { type: 'send_text', label: 'Mensagem de Texto', icon: '💬', category: 'message', color: '#3b82f6', description: 'Envia texto simples via WhatsApp', defaultData: { text: '' } },
  { type: 'send_image', label: 'Imagem + Texto', icon: '🖼️', category: 'message', color: '#3b82f6', description: 'Envia imagem com legenda opcional', defaultData: { imageUrl: '', caption: '' } },
  { type: 'send_audio', label: 'Áudio', icon: '🎙️', category: 'message', color: '#3b82f6', description: 'Envia áudio de voz', defaultData: { audioUrl: '' } },
  { type: 'send_file', label: 'Arquivo + Texto', icon: '📎', category: 'message', color: '#3b82f6', description: 'Envia documento com legenda', defaultData: { fileUrl: '', caption: '' } },
  { type: 'send_video', label: 'Vídeo + Texto', icon: '🎬', category: 'message', color: '#3b82f6', description: 'Envia vídeo com legenda', defaultData: { videoUrl: '', caption: '' } },
  // Logic
  { type: 'delay', label: 'Pausa / Delay', icon: '⏸️', category: 'logic', color: '#a855f7', description: 'Aguarda um tempo antes de continuar', defaultData: { delaySeconds: 5, unit: 'seconds' } },
  { type: 'wait_reply', label: 'Aguardar Resposta', icon: '⌛', category: 'logic', color: '#a855f7', description: 'Aguarda resposta do cliente', defaultData: { timeoutMinutes: 60, saveToField: '' } },
  { type: 'condition', label: 'Condição (If/Else)', icon: '🔀', category: 'logic', color: '#a855f7', description: 'Ramifica baseado em condições', defaultData: { field: '', operator: 'equals', value: '' } },
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
