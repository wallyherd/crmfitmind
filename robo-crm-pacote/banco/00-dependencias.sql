-- ============================================================
-- Dependencias minimas para instalar o robo + CRM FORA do FitMind.
--
-- 01-robo-crm.sql chama coisas que no FitMind ja existiam. Aqui estao
-- as versoes minimas delas, com os MESMOS nomes e assinaturas, para que
-- 01-robo-crm.sql entre sem nenhuma edicao.
--
-- Requer um projeto Supabase: usa auth.users, auth.uid() e o papel
-- "authenticated". Nao rode isto dentro do banco do FitMind -- la estas
-- tabelas ja existem, maiores.
-- ============================================================

-- ------------------------------------------------ usuarios
-- Uma linha por usuario do Supabase Auth. O robo e o CRM gravam
-- profiles.id (nao auth.users.id) em criado_por, responsavel_id etc.
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  email text,
  phone text,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Todo usuario novo ganha o seu profile na hora do cadastro.
CREATE OR REPLACE FUNCTION public.criar_profile_do_usuario()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, email, name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END; $function$;

CREATE TRIGGER trg_criar_profile_do_usuario
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.criar_profile_do_usuario();

-- ------------------------------------------------ empresas
-- "partner" e o nome que o FitMind da para a empresa cliente. E o
-- escopo 'parceiro' do robo e do CRM: owner_id = partners.id.
CREATE TABLE public.partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  fantasy_name text NOT NULL,
  city text,
  state text,
  status text NOT NULL DEFAULT 'ativo',
  business_area text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Quem trabalha em cada empresa. partner_pode() so enxerga esta tabela:
-- o DONO tambem precisa de uma linha aqui, com papel = 'owner'.
-- Para os membros, permissoes lista os modulos liberados: 'robo', 'crm'.
CREATE TABLE public.partner_members (
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  papel text NOT NULL DEFAULT 'membro' CHECK (papel IN ('owner', 'membro')),
  permissoes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (partner_id, profile_id)
);

-- Fuso de cada empresa (a cota diaria do chip vira a meia-noite DELA)
-- e o grupo de empresas que dividem o mesmo numero de WhatsApp.
CREATE TABLE public.partner_acesso_config (
  partner_id uuid PRIMARY KEY REFERENCES public.partners(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  grupo_id uuid
);

-- crm_cartoes.lead_id aponta para ca. No FitMind e a captura do site;
-- fora dele pode ficar vazia.
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------ permissoes
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = _user_id AND role = 'admin')
$function$;

CREATE OR REPLACE FUNCTION public.partner_pode(_partner_id uuid, _permissao text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT true FROM public.partner_members m
    JOIN public.profiles pr ON pr.id = m.profile_id
    WHERE m.partner_id = _partner_id AND pr.user_id = auth.uid()
      AND (m.papel = 'owner' OR _permissao = ANY(m.permissoes))
    LIMIT 1
  ), false) OR COALESCE(public.is_admin(auth.uid()), false)
$function$;

CREATE OR REPLACE FUNCTION public.academia_parceiros_do_grupo(p_partner_id uuid)
 RETURNS TABLE(partner_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH meu AS (SELECT c.grupo_id FROM public.partner_acesso_config c WHERE c.partner_id = p_partner_id)
  SELECT c.partner_id FROM public.partner_acesso_config c CROSS JOIN meu
  WHERE meu.grupo_id IS NOT NULL AND c.grupo_id = meu.grupo_id
  UNION
  SELECT p_partner_id
$function$;

-- ------------------------------------------------ seguranca
-- As funcoes acima sao SECURITY DEFINER e nao dependem destas policies.
-- Sem policy, a tabela fica fechada para o navegador e aberta so para a
-- service role -- que e o que se quer para partner_members e config.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_acesso_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver meu profile" ON public.profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Ver empresas onde trabalho" ON public.partners
  FOR SELECT TO authenticated
  USING (public.partner_pode(id, 'robo') OR public.partner_pode(id, 'crm'));
