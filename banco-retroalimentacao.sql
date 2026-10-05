-- ============================================================
-- Módulo de Retroalimentação IA do CRM (FitMind / Robô WhatsApp)
-- ============================================================

-- 1. Configurações de Retroalimentação por Parceiro / Empresa
CREATE TABLE IF NOT EXISTS public.ia_retroalimentacao_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid REFERENCES public.partners(id) ON DELETE CASCADE,
  github_repo text,                      -- Formato: "dono/repositorio"
  github_branch text DEFAULT 'main',     -- Branch (ex: "main" ou "master")
  github_token text,                     -- GitHub Personal Access Token (classic ou fine-grained)
  github_path_pattern text DEFAULT 'conversas/{ano}-{mes}-{dia}.txt', -- Padrão do caminho do arquivo
  gemini_api_key text,                   -- Chave Google Gemini API (opcional se configurado no servidor)
  horario_execucao text DEFAULT '07:30', -- Horário matinal previsto para busca diária
  quadro_id uuid REFERENCES public.crm_quadros(id) ON DELETE SET NULL, -- Funil do CRM para vincular os cartões
  auto_sincronizar boolean DEFAULT true, -- Ativa/desativa automação diária
  ultima_execucao timestamptz,
  ultimo_status text,                    -- "sucesso" | "erro" | "processando"
  ultimo_erro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Tabela de Relatórios Diários da IA
CREATE TABLE IF NOT EXISTS public.ia_relatorios_diarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid REFERENCES public.partners(id) ON DELETE CASCADE,
  data_referencia date NOT NULL,
  arquivo_origem text,                   -- Nome do arquivo lido no Git ou upload manual
  total_conversas integer DEFAULT 0,
  vendas_fechadas integer DEFAULT 0,
  perdas_vendas integer DEFAULT 0,
  conversas_abertas integer DEFAULT 0,
  iniciadas_nao_finalizadas integer DEFAULT 0,
  resumo_executivo text,
  pontos_melhoria text,
  leads_analisados jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'concluido',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Índices para buscas rápidas
CREATE INDEX IF NOT EXISTS idx_ia_relatorios_partner_data ON public.ia_relatorios_diarios(partner_id, data_referencia);
CREATE INDEX IF NOT EXISTS idx_ia_config_partner ON public.ia_retroalimentacao_config(partner_id);
