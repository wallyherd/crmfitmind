-- ============================================================
-- Atualização: Módulo de Gerenciamento de Usuários e Assinaturas
-- ============================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'suspenso', 'expirado'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS expira_em timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS senha_hash text;

-- Garante que o admin tenha acesso vitalício
UPDATE public.profiles
SET role = 'admin', status = 'ativo', expira_em = NULL
WHERE email = 'admin@fitmind.com.br';
