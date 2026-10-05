-- ==============================================================================
-- FitMind CRM: Script Definitivo de Criação do Administrador Master
-- E-mail: admin@fitmind.com
-- Senha:  Fitmind123
-- ==============================================================================
-- Execute todo este conteúdo no SQL Editor do seu Supabase.

-- PASSO 1: Adicionar as colunas necessárias na tabela profiles (caso ainda não existam)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ativo';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS expira_em timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS senha_hash text;

-- PASSO 2: Criar índice único no email para permitir ON CONFLICT (email)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles (email);

-- PASSO 3: Inserir ou atualizar o usuário admin@fitmind.com
INSERT INTO public.profiles (email, name, role, status, senha_hash, phone, expira_em)
VALUES (
  'admin@fitmind.com',
  'Administrador FitMind',
  'admin',
  'ativo',
  'Fitmind123',
  '+5565996221282',
  NULL
)
ON CONFLICT (email) DO UPDATE SET
  role = 'admin',
  status = 'ativo',
  senha_hash = 'Fitmind123',
  name = 'Administrador FitMind',
  expira_em = NULL;

-- PASSO 4: Atualizar também admin@fitmind.com.br por garantia
INSERT INTO public.profiles (email, name, role, status, senha_hash, phone, expira_em)
VALUES (
  'admin@fitmind.com.br',
  'Administrador FitMind',
  'admin',
  'ativo',
  'Fitmind123',
  '+5565996221282',
  NULL
)
ON CONFLICT (email) DO UPDATE SET
  role = 'admin',
  status = 'ativo',
  senha_hash = 'Fitmind123',
  name = 'Administrador FitMind',
  expira_em = NULL;
