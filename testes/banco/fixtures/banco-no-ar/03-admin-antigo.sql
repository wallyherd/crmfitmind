-- Script antigo "criar-usuario-admin.sql": as sementes de admin com senha em texto puro na coluna profiles.senha_hash.
-- A senha de verdade do script antigo não entra no repositório: o teste usa um texto qualquer no lugar.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ativo';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS expira_em timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS senha_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles (email);

INSERT INTO public.profiles (email, name, role, status, senha_hash, phone, expira_em)
VALUES ('admin@fitmind.com', 'Administrador FitMind', 'admin', 'ativo', 'senha-antiga-em-texto-puro', '+5565000000000', NULL)
ON CONFLICT (email) DO UPDATE SET role = 'admin', status = 'ativo', senha_hash = 'senha-antiga-em-texto-puro',
  name = 'Administrador FitMind', expira_em = NULL;

INSERT INTO public.profiles (email, name, role, status, senha_hash, phone, expira_em)
VALUES ('admin@fitmind.com.br', 'Administrador FitMind', 'admin', 'ativo', 'senha-antiga-em-texto-puro', '+5565000000000', NULL)
ON CONFLICT (email) DO UPDATE SET role = 'admin', status = 'ativo', senha_hash = 'senha-antiga-em-texto-puro',
  name = 'Administrador FitMind', expira_em = NULL;
