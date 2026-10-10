-- ============================================================
-- 001 - Fase 0: seguranca, para o banco que JA esta no ar.
--
-- Idempotente: pode rodar duas vezes sem erro e sem mudar nada na segunda.
-- Pre-requisito: as tabelas do banco-instalar-completo.sql (mesmo de uma
-- versao antiga) e do banco-retroalimentacao.sql. Num banco instalado do
-- zero com os arquivos atuais isto nao muda nada.
-- Cuidado: rodar de novo DEPOIS de migracoes mais novas apaga as policies que
-- elas criaram nestas tabelas (passo 5); rode as mais novas de novo em seguida.
--
-- O que faz:
--   1. profiles com status/expira_em/partner_id e SEM senha_hash
--   2. gatilho que cria o profile a partir de auth.users (e os que faltam)
--   3. funcoes de permissao (conta suspensa ou vencida nao ve nada) e
--      bootstrap_empresa_completa consertado
--   4. RLS ligada em todas as tabelas do CRM
--   5. policies: apaga TODAS as dessas tabelas (inclusive as afrouxadas a
--      mao no painel) e recria as do instalador
--   6. permissoes: segredo do conector escondido, cadastro so pelo servidor,
--      funcoes de acao sem EXECUTE para anon/authenticated
-- ============================================================
BEGIN;
SET LOCAL check_function_bodies = off;

-- ------------------------------------------------ 1. profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ativo';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS expira_em timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS partner_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_status_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_status_check CHECK (status IN ('ativo', 'suspenso', 'expirado'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_partner_id_fkey') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_partner_id_fkey
      FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE SET NULL;
  END IF;
  -- Senha em texto puro: apaga o conteudo e a coluna. Login e so pelo Supabase Auth.
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attname = 'senha_hash' AND NOT attisdropped) THEN
    EXECUTE 'UPDATE public.profiles SET senha_hash = NULL';
    EXECUTE 'ALTER TABLE public.profiles DROP COLUMN senha_hash';
  END IF;
END $$;

-- Contas semeadas com a senha mestra publicada: sem admin e suspensas.
-- O usuario correspondente no Auth (se existir) deve ser apagado no painel.
UPDATE public.profiles SET role = 'user', status = 'suspenso'
 WHERE lower(email) LIKE 'admin@fitmind.com%' AND (role <> 'user' OR status <> 'suspenso');

-- ------------------------------------------------ 2. profile a partir do Auth
CREATE OR REPLACE FUNCTION public.criar_profile_do_usuario()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, email, name, status)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name', 'suspenso')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_criar_profile_do_usuario ON auth.users;
CREATE TRIGGER trg_criar_profile_do_usuario
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.criar_profile_do_usuario();

INSERT INTO public.profiles (user_id, email, name, status)
SELECT u.id, u.email, u.raw_user_meta_data->>'name', 'suspenso'
  FROM auth.users u
 WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = u.id);

-- ------------------------------------------------ 3. funcoes
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = _user_id AND role = 'admin' AND status = 'ativo')
$function$;

-- Conta suspensa ou com acesso vencido nao enxerga a empresa (o servidor
-- devolve 403 pelo mesmo motivo; aqui vale para o acesso direto ao banco).
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
      AND pr.status = 'ativo' AND (pr.expira_em IS NULL OR pr.expira_em > now())
      AND (m.papel = 'owner' OR _permissao = ANY(m.permissoes))
    LIMIT 1
  ), false) OR COALESCE(public.is_admin(auth.uid()), false)
$function$;

-- Cria empresa completa (funil, fluxo de boas-vindas). So o servidor chama
-- (service role, rota de admin); o EXECUTE e revogado de anon/authenticated.
-- O dono e o profile do usuario _user_id; sem usuario, nasce um profile
-- sem login, sempre com papel 'user'.
CREATE OR REPLACE FUNCTION public.bootstrap_empresa_completa(
  _user_id uuid DEFAULT NULL,
  _empresa_nome text DEFAULT 'Minha Empresa',
  _cidade text DEFAULT NULL,
  _estado text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_profile_id uuid;
  v_partner_id uuid;
  v_quadro_id uuid;
  v_fluxo_id uuid;
  v_passo_ini_id uuid;
  v_passo_atendente_id uuid;
BEGIN
  IF _user_id IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id) THEN
    SELECT id INTO v_profile_id FROM public.profiles WHERE user_id = _user_id;
    IF v_profile_id IS NULL THEN
      INSERT INTO public.profiles (user_id, name, role)
      VALUES (_user_id, _empresa_nome, 'user')
      RETURNING id INTO v_profile_id;
    END IF;
  ELSE
    INSERT INTO public.profiles (name, role)
    VALUES (_empresa_nome, 'user')
    RETURNING id INTO v_profile_id;
  END IF;

  INSERT INTO public.partners (profile_id, fantasy_name, city, state, status)
  VALUES (v_profile_id, _empresa_nome, _cidade, _estado, 'ativo')
  RETURNING id INTO v_partner_id;

  INSERT INTO public.partner_members (partner_id, profile_id, papel, permissoes)
  VALUES (v_partner_id, v_profile_id, 'owner', ARRAY['robo', 'crm'])
  ON CONFLICT (partner_id, profile_id) DO UPDATE SET papel = 'owner', permissoes = ARRAY['robo', 'crm'];

  INSERT INTO public.partner_acesso_config (partner_id, timezone)
  VALUES (v_partner_id, 'America/Cuiaba')
  ON CONFLICT (partner_id) DO NOTHING;

  -- Funil criado aqui e nao por crm_criar_quadro(): aquela checa auth.uid(),
  -- que e nulo quando quem chama e o servidor.
  INSERT INTO public.crm_quadros (escopo, owner_id, nome, tipo, criado_por)
  VALUES ('parceiro', v_partner_id, 'Funil de Vendas', 'funil', v_profile_id)
  RETURNING id INTO v_quadro_id;

  INSERT INTO public.crm_colunas (quadro_id, nome, posicao, tipo)
  SELECT v_quadro_id, e.nome, e.ordem * 1000, e.tipo
  FROM unnest(
    ARRAY['Novo contato', 'Em conversa', 'Proposta enviada', 'Negociando', 'Venda fechada', 'Perdido'],
    ARRAY['normal', 'normal', 'normal', 'normal', 'ganho', 'perdido']
  ) WITH ORDINALITY AS e(nome, tipo, ordem);

  INSERT INTO public.bot_fluxos (escopo, owner_id, nome, ativo, gatilho_tipo)
  VALUES ('parceiro', v_partner_id, 'Atendimento Geral', true, 'primeira_mensagem')
  RETURNING id INTO v_fluxo_id;

  INSERT INTO public.bot_passos (fluxo_id, chave, tipo, conteudo, posicao)
  VALUES (v_fluxo_id, 'atendente', 'transferir', 'Aguarde um momento! Já chamei um atendente da nossa equipe para falar com você.', 2)
  RETURNING id INTO v_passo_atendente_id;

  INSERT INTO public.bot_passos (fluxo_id, chave, tipo, conteudo, posicao)
  VALUES (v_fluxo_id, 'inicio', 'pergunta',
          'Olá! Seja bem-vindo(a) à ' || _empresa_nome || E'! 👋\nComo podemos te ajudar hoje?\n\n1 - Conhecer nossos produtos/serviços\n2 - Falar com atendente humano\n3 - Horários de funcionamento',
          1)
  RETURNING id INTO v_passo_ini_id;

  UPDATE public.bot_fluxos SET passo_inicial_id = v_passo_ini_id WHERE id = v_fluxo_id;

  INSERT INTO public.bot_opcoes (passo_id, rotulo, gatilho, proximo_passo_id, posicao)
  VALUES (v_passo_ini_id, 'Falar com atendente', '2', v_passo_atendente_id, 2);

  RETURN jsonb_build_object(
    'ok', true,
    'partner_id', v_partner_id,
    'profile_id', v_profile_id,
    'quadro_id', v_quadro_id,
    'fluxo_id', v_fluxo_id
  );
END;
$function$;

-- ------------------------------------------------ 4. RLS
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'partners', 'partner_members', 'partner_acesso_config', 'leads',
    'bot_conexoes', 'bot_conversas', 'bot_disparo_alvos', 'bot_disparos', 'bot_fluxos',
    'bot_mensagens', 'bot_opcoes', 'bot_passos', 'bot_verificacoes', 'crm_atividades',
    'crm_cartao_etiquetas', 'crm_cartoes', 'crm_colunas', 'crm_etiquetas', 'crm_quadros',
    'conector_versoes', 'ia_retroalimentacao_config', 'ia_relatorios_diarios']
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------ 5. policies
-- Apaga todas: uma policy "USING (true)" criada a mao continuaria abrindo a
-- tabela mesmo depois de recriar as certas (policies permissivas somam).
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname, tablename FROM pg_policies
     WHERE schemaname = 'public' AND tablename IN (
       'profiles', 'partners', 'partner_members', 'partner_acesso_config', 'leads',
       'bot_conexoes', 'bot_conversas', 'bot_disparo_alvos', 'bot_disparos', 'bot_fluxos',
       'bot_mensagens', 'bot_opcoes', 'bot_passos', 'bot_verificacoes', 'crm_atividades',
       'crm_cartao_etiquetas', 'crm_cartoes', 'crm_colunas', 'crm_etiquetas', 'crm_quadros',
       'conector_versoes', 'ia_retroalimentacao_config', 'ia_relatorios_diarios')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- partner_members, partner_acesso_config, leads, bot_verificacoes,
-- conector_versoes e ia_retroalimentacao_config ficam sem policy: so o servidor.
CREATE POLICY "Ver meu profile" ON public.profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Ver empresas onde trabalho" ON public.partners
  FOR SELECT TO authenticated
  USING (public.partner_pode(id, 'robo') OR public.partner_pode(id, 'crm'));

CREATE POLICY "Apagar minhas conexoes" ON public.bot_conexoes AS PERMISSIVE FOR DELETE TO authenticated USING (bot_acesso_dono(escopo, owner_id));
CREATE POLICY "Criar conexao no meu escopo" ON public.bot_conexoes AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (bot_acesso_dono(escopo, owner_id));
CREATE POLICY "Editar minhas conexoes" ON public.bot_conexoes AS PERMISSIVE FOR UPDATE TO authenticated USING (bot_acesso_dono(escopo, owner_id)) WITH CHECK (bot_acesso_dono(escopo, owner_id));
CREATE POLICY "Ver conexoes do meu escopo" ON public.bot_conexoes AS PERMISSIVE FOR SELECT TO authenticated USING (bot_acesso_dono(escopo, owner_id));
CREATE POLICY "Acesso total via conexao" ON public.bot_conversas AS PERMISSIVE FOR ALL TO authenticated USING (bot_acesso_conexao(conexao_id)) WITH CHECK (bot_acesso_conexao(conexao_id));
CREATE POLICY "Acesso via disparo" ON public.bot_disparo_alvos AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM bot_disparos d
  WHERE ((d.id = bot_disparo_alvos.disparo_id) AND bot_acesso_dono(d.escopo, d.owner_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM bot_disparos d
  WHERE ((d.id = bot_disparo_alvos.disparo_id) AND bot_acesso_dono(d.escopo, d.owner_id)))));
CREATE POLICY "Acesso via dono" ON public.bot_disparos AS PERMISSIVE FOR ALL TO authenticated USING (bot_acesso_dono(escopo, owner_id)) WITH CHECK (bot_acesso_dono(escopo, owner_id));
CREATE POLICY "Apagar meus fluxos" ON public.bot_fluxos AS PERMISSIVE FOR DELETE TO authenticated USING (bot_acesso_dono(escopo, owner_id));
CREATE POLICY "Criar fluxo no meu escopo" ON public.bot_fluxos AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (bot_acesso_dono(escopo, owner_id));
CREATE POLICY "Editar meus fluxos" ON public.bot_fluxos AS PERMISSIVE FOR UPDATE TO authenticated USING (bot_acesso_dono(escopo, owner_id)) WITH CHECK (bot_acesso_dono(escopo, owner_id));
CREATE POLICY "Ver fluxos do meu escopo" ON public.bot_fluxos AS PERMISSIVE FOR SELECT TO authenticated USING ((bot_acesso_dono(escopo, owner_id) OR (modelo = true)));
CREATE POLICY "Acesso total via conversa" ON public.bot_mensagens AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM bot_conversas c
  WHERE ((c.id = bot_mensagens.conversa_id) AND bot_acesso_conexao(c.conexao_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM bot_conversas c
  WHERE ((c.id = bot_mensagens.conversa_id) AND bot_acesso_conexao(c.conexao_id)))));
CREATE POLICY "Acesso total via passo" ON public.bot_opcoes AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM bot_passos p
  WHERE ((p.id = bot_opcoes.passo_id) AND bot_acesso_fluxo(p.fluxo_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM bot_passos p
  WHERE ((p.id = bot_opcoes.passo_id) AND bot_acesso_fluxo(p.fluxo_id)))));
CREATE POLICY "Acesso total via fluxo" ON public.bot_passos AS PERMISSIVE FOR ALL TO authenticated USING (bot_acesso_fluxo(fluxo_id)) WITH CHECK (bot_acesso_fluxo(fluxo_id));
CREATE POLICY "Acesso total via cartao" ON public.crm_atividades AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM crm_cartoes c
  WHERE ((c.id = crm_atividades.cartao_id) AND crm_acesso_quadro(c.quadro_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM crm_cartoes c
  WHERE ((c.id = crm_atividades.cartao_id) AND crm_acesso_quadro(c.quadro_id)))));
CREATE POLICY "Acesso total via cartao" ON public.crm_cartao_etiquetas AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM crm_cartoes c
  WHERE ((c.id = crm_cartao_etiquetas.cartao_id) AND crm_acesso_quadro(c.quadro_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM crm_cartoes c
  WHERE ((c.id = crm_cartao_etiquetas.cartao_id) AND crm_acesso_quadro(c.quadro_id)))));
CREATE POLICY "Acesso total via quadro" ON public.crm_cartoes AS PERMISSIVE FOR ALL TO authenticated USING (crm_acesso_quadro(quadro_id)) WITH CHECK (crm_acesso_quadro(quadro_id));
CREATE POLICY "Acesso total via quadro" ON public.crm_colunas AS PERMISSIVE FOR ALL TO authenticated USING (crm_acesso_quadro(quadro_id)) WITH CHECK (crm_acesso_quadro(quadro_id));
CREATE POLICY "Acesso total via quadro" ON public.crm_etiquetas AS PERMISSIVE FOR ALL TO authenticated USING (crm_acesso_quadro(quadro_id)) WITH CHECK (crm_acesso_quadro(quadro_id));
CREATE POLICY "Apagar meus quadros" ON public.crm_quadros AS PERMISSIVE FOR DELETE TO authenticated USING (crm_acesso_quadro(id));
CREATE POLICY "Criar quadro no meu escopo" ON public.crm_quadros AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((COALESCE(is_admin(auth.uid()), false) OR
CASE escopo
    WHEN 'parceiro'::text THEN partner_pode(owner_id, 'crm'::text)
    WHEN 'coach'::text THEN (EXISTS ( SELECT 1
       FROM profiles pr
      WHERE ((pr.id = crm_quadros.owner_id) AND (pr.user_id = auth.uid()))))
    WHEN 'profissional'::text THEN (EXISTS ( SELECT 1
       FROM profiles pr
      WHERE ((pr.id = crm_quadros.owner_id) AND (pr.user_id = auth.uid()))))
    WHEN 'admin'::text THEN COALESCE(is_admin(auth.uid()), false)
    ELSE false
END));
CREATE POLICY "Editar meus quadros" ON public.crm_quadros AS PERMISSIVE FOR UPDATE TO authenticated USING (crm_acesso_quadro(id)) WITH CHECK (crm_acesso_quadro(id));
CREATE POLICY "Ver quadros do meu escopo" ON public.crm_quadros AS PERMISSIVE FOR SELECT TO authenticated USING ((crm_acesso_quadro(id) OR (modelo = true)));

DO $$
BEGIN
  IF to_regclass('public.ia_relatorios_diarios') IS NOT NULL THEN
    CREATE POLICY "Ler relatorios da minha empresa" ON public.ia_relatorios_diarios
      FOR SELECT TO authenticated USING (public.partner_pode(partner_id, 'crm'));
  END IF;
END $$;

-- ------------------------------------------------ 6. permissoes
-- >>> permissoes (bloco identico no instalador e na migracao 001; um teste confere)
-- O navegador fala com o banco usando o JWT do usuario (papel authenticated)
-- e a RLS escolhe as linhas. Aqui fica o que a RLS nao cobre: coluna secreta,
-- escrita em tabela de cadastro e funcao que age sem checar quem chama.
DO $permissoes$
DECLARE
  t text;
  f record;
  v_cols text;
  tabelas_crm text[] := ARRAY[
    'profiles', 'partners', 'partner_members', 'partner_acesso_config', 'leads',
    'bot_conexoes', 'bot_conversas', 'bot_disparo_alvos', 'bot_disparos', 'bot_fluxos',
    'bot_mensagens', 'bot_opcoes', 'bot_passos', 'bot_verificacoes', 'crm_atividades',
    'crm_cartao_etiquetas', 'crm_cartoes', 'crm_colunas', 'crm_etiquetas', 'crm_quadros',
    'conector_versoes'];
  -- cadastro e acesso: so o servidor (service role) grava
  tabelas_cadastro text[] := ARRAY['profiles', 'partners', 'partner_members', 'partner_acesso_config', 'leads'];
  -- so o servidor le e grava
  tabelas_servidor text[] := ARRAY['bot_verificacoes', 'conector_versoes'];
  funcoes_crm text[] := ARRAY[
    'academia_parceiros_do_grupo', 'bootstrap_empresa_completa', 'bot_acesso_conexao', 'bot_acesso_dono',
    'bot_acesso_fluxo', 'bot_bloquear_conexao', 'bot_clonar_fluxo', 'bot_confirmar_verificacao',
    'bot_contar_envio', 'bot_dia_da_conexao', 'bot_escolher_conexao', 'bot_marcar_ultima_mensagem',
    'bot_registrar_no_cartao', 'bot_vincular_cartao', 'criar_profile_do_usuario', 'crm_acesso_quadro',
    'crm_clonar_quadro', 'crm_criar_quadro', 'crm_importar_contatos', 'crm_registrar_mudanca_coluna',
    'crm_touch_updated_at', 'is_admin', 'partner_pode'];
  -- usadas dentro das policies (precisam de EXECUTE para o authenticated) ou
  -- que conferem auth.uid() por dentro antes de agir
  funcoes_usuario text[] := ARRAY[
    'is_admin', 'partner_pode', 'bot_acesso_dono', 'bot_acesso_conexao', 'bot_acesso_fluxo',
    'crm_acesso_quadro', 'bot_clonar_fluxo', 'crm_clonar_quadro', 'crm_criar_quadro', 'crm_importar_contatos'];
BEGIN
  FOREACH t IN ARRAY tabelas_crm LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    -- anon (sem login) nao le nem grava nada do CRM
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    -- TRUNCATE passa por cima da RLS
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', t);
    IF t = ANY (tabelas_cadastro) THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM authenticated', t);
    END IF;
    IF t = ANY (tabelas_servidor) THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    END IF;
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;

  -- bot_conexoes: o usuario le todas as colunas menos o segredo do conector.
  -- Coluna nova so aparece para o navegador depois de rodar este bloco de novo.
  SELECT string_agg(quote_ident(attname), ', ') INTO v_cols
    FROM pg_attribute WHERE attrelid = 'public.bot_conexoes'::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE 'REVOKE SELECT ON public.bot_conexoes FROM anon, authenticated';
  EXECUTE format('REVOKE SELECT (%s) ON public.bot_conexoes FROM anon, authenticated', v_cols);
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO v_cols
    FROM pg_attribute WHERE attrelid = 'public.bot_conexoes'::regclass AND attnum > 0 AND NOT attisdropped
     AND attname NOT IN ('webhook_segredo', 'vinculo_hash');
  EXECUTE format('GRANT SELECT (%s) ON public.bot_conexoes TO authenticated', v_cols);

  -- Funcoes: em todas as sobrecargas. As de acao (criar empresa, vincular
  -- cartao, bloquear conexao, contar envio...) nao checam quem chama: so o
  -- servidor executa.
  FOR f IN
    SELECT p.oid::regprocedure AS assinatura, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY (funcoes_crm)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.assinatura);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.assinatura);
    IF f.proname = ANY (funcoes_usuario) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.assinatura);
    END IF;
  END LOOP;
END
$permissoes$;
-- <<< permissoes

-- Tabelas da retroalimentacao (mesmo que banco-retroalimentacao.sql).
DO $$
BEGIN
  IF to_regclass('public.ia_retroalimentacao_config') IS NOT NULL THEN
    REVOKE ALL ON public.ia_retroalimentacao_config FROM anon, authenticated;
    GRANT ALL ON public.ia_retroalimentacao_config TO service_role;
  END IF;
  IF to_regclass('public.ia_relatorios_diarios') IS NOT NULL THEN
    REVOKE ALL ON public.ia_relatorios_diarios FROM anon;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.ia_relatorios_diarios FROM authenticated;
    GRANT ALL ON public.ia_relatorios_diarios TO service_role;
  END IF;
END $$;

COMMIT;
