-- ============================================================
-- Atualização: Módulo de Gerenciamento de Usuários e Assinaturas
-- ============================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'suspenso', 'expirado'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS expira_em timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS senha_hash text;

-- Garante que o admin tenha acesso vitalício
UPDATE public.profiles
SET role = 'admin', status = 'ativo', expira_em = NULL, senha_hash = 'Fitmind123'
WHERE email IN ('admin@fitmind.com', 'admin@fitmind.com.br');

INSERT INTO public.profiles (email, name, role, status, senha_hash, phone, expira_em)
SELECT 'admin@fitmind.com', 'Administrador FitMind', 'admin', 'ativo', 'Fitmind123', '+5565996221282', NULL
WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE email = 'admin@fitmind.com');
