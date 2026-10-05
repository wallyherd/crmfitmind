-- ============================================================
-- FitMind CRM: Criação / Atualização do Administrador Master
-- E-mail: admin@fitmind.com
-- Senha:  Fitmind123
-- ============================================================

DO $$
BEGIN
  -- 1. Garante que as colunas existam na tabela public.profiles
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'suspenso', 'expirado'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'expira_em'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN expira_em timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'partner_id'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'senha_hash'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN senha_hash text;
  END IF;

  -- 2. Atualiza ou insere o administrador admin@fitmind.com
  UPDATE public.profiles
  SET role = 'admin',
      status = 'ativo',
      senha_hash = 'Fitmind123',
      name = 'Administrador FitMind',
      phone = '+5565996221282',
      expira_em = NULL
  WHERE email = 'admin@fitmind.com';

  IF NOT FOUND THEN
    INSERT INTO public.profiles (
      email,
      name,
      role,
      status,
      senha_hash,
      phone,
      expira_em
    ) VALUES (
      'admin@fitmind.com',
      'Administrador FitMind',
      'admin',
      'ativo',
      'Fitmind123',
      '+5565996221282',
      NULL
    );
  END IF;

  -- 3. Mantém compatibilidade com admin@fitmind.com.br
  UPDATE public.profiles
  SET role = 'admin',
      status = 'ativo',
      senha_hash = 'Fitmind123',
      name = 'Administrador FitMind',
      expira_em = NULL
  WHERE email = 'admin@fitmind.com.br';

END $$;
