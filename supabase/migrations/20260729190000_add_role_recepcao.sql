-- Papel "Recepção": usuário operacional do tenant Recepção (Conversas, Transmissão,
-- Modelos, Bots). Não é privilegiado: não enxerga funil/Kanban (guard de rota) e só
-- vê números de WhatsApp concedidos via user_permission_overrides (scope whatsapp_number).
-- ADD VALUE fica em migração própria: o valor novo não pode ser usado na mesma transação.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'recepcao';
