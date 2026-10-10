-- ============================================================
-- Limpar as sementes do banco antigo. OPCIONAL. APAGA DADOS.
--
-- O banco no ar (diagnostico de 09/10) tem 3 profiles SEM LOGIN (os admins da era da senha mestra e o dono de
-- uma empresa-semente) e 1 empresa-semente com 1 funil, 0 conexoes e 0 conversas. Este arquivo apaga so isso.
--
-- Como usar (o passo a passo esta em APLICAR-NO-AR.md):
--   1. PARTE 1 (so le): selecione so o trecho da PARTE 1 e clique em Run. Confira a lista.
--   2. Se a lista for o que voce espera, troque  false  por  true  na linha marcada na PARTE 2 e rode o arquivo
--      inteiro. Sem trocar, o arquivo inteiro NAO apaga nada.
--   3. A PARTE 2 se recusa a apagar (e nao apaga nada) se a empresa-semente tiver conexao, conversa, cartao ou
--      campanha, ou se algum desses profiles pertencer a uma empresa que tem gente com login.
--
-- Rode DEPOIS das migracoes 001 a 005 e ANTES de criar o seu usuario em Authentication.
-- Nunca apaga quem tem login (profiles.user_id preenchido) nem empresa com membro que tem login.
-- ============================================================

-- PARTE 1: conferencia (so le) ---------------------------------------------------------------
-- Quem seria apagado. "quem" e o que aparece na lista; "dados" tem que ser 0 nas empresas.
WITH sem_login AS (
  SELECT pr.id, pr.email, pr.name, pr.role, pr.status, pr.created_at
    FROM public.profiles pr WHERE pr.user_id IS NULL
), semente AS (
  SELECT p.id, p.fantasy_name
    FROM public.partners p
    LEFT JOIN public.profiles dono ON dono.id = p.profile_id
   WHERE (dono.id IS NULL OR dono.user_id IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.partner_members m JOIN public.profiles pr ON pr.id = m.profile_id
                      WHERE m.partner_id = p.id AND pr.user_id IS NOT NULL)
)
SELECT 'profile sem login' AS tipo, COALESCE(email, name, id::text) AS quem, role || ' / ' || status AS detalhe,
       0 AS dados
  FROM sem_login
UNION ALL
SELECT 'empresa-semente', s.fantasy_name || ' (' || s.id || ')',
       (SELECT count(*) FROM public.crm_quadros q WHERE q.escopo = 'parceiro' AND q.owner_id = s.id) || ' funil(is), '
         || (SELECT count(*) FROM public.bot_fluxos f WHERE f.escopo = 'parceiro' AND f.owner_id = s.id) || ' fluxo(s)',
       (SELECT count(*) FROM public.bot_conexoes c WHERE c.escopo = 'parceiro' AND c.owner_id = s.id)
       + (SELECT count(*) FROM public.crm_cartoes ct JOIN public.crm_quadros q ON q.id = ct.quadro_id
           WHERE q.escopo = 'parceiro' AND q.owner_id = s.id)
       + (SELECT count(*) FROM public.bot_disparos d WHERE d.escopo = 'parceiro' AND d.owner_id = s.id)
  FROM semente s
 ORDER BY 1, 2;

-- PARTE 2: apagar (so apaga se voce trocar false por true) -------------------------------------
DO $sementes$
DECLARE
  v_confirmo constant boolean := false;  -- <<< TROQUE false POR true PARA APAGAR DE VERDADE
  v_empresas uuid[];
  v_perfis uuid[];
  v_dados bigint;
  v_estranho bigint;
BEGIN
  SELECT COALESCE(array_agg(p.id), '{}') INTO v_empresas
    FROM public.partners p
    LEFT JOIN public.profiles dono ON dono.id = p.profile_id
   WHERE (dono.id IS NULL OR dono.user_id IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.partner_members m JOIN public.profiles pr ON pr.id = m.profile_id
                      WHERE m.partner_id = p.id AND pr.user_id IS NOT NULL);
  SELECT COALESCE(array_agg(id), '{}') INTO v_perfis FROM public.profiles WHERE user_id IS NULL;

  -- Tem dado de verdade? Entao nao e semente: para tudo.
  SELECT (SELECT count(*) FROM public.bot_conexoes WHERE escopo = 'parceiro' AND owner_id = ANY (v_empresas))
       + (SELECT count(*) FROM public.crm_cartoes ct JOIN public.crm_quadros q ON q.id = ct.quadro_id
           WHERE q.escopo = 'parceiro' AND q.owner_id = ANY (v_empresas))
       + (SELECT count(*) FROM public.bot_disparos WHERE escopo = 'parceiro' AND owner_id = ANY (v_empresas))
    INTO v_dados;
  IF v_dados > 0 THEN
    RAISE EXCEPTION 'As empresas sem login tem % item(ns) de verdade (conexao, cartao ou campanha). Nada foi apagado.', v_dados;
  END IF;

  -- Profile sem login que participa de empresa que tem gente com login: nao e semente.
  SELECT count(*) INTO v_estranho
    FROM public.partner_members m
   WHERE m.profile_id = ANY (v_perfis) AND NOT (m.partner_id = ANY (v_empresas));
  IF v_estranho > 0 THEN
    RAISE EXCEPTION 'Um profile sem login participa de empresa com usuario de verdade. Nada foi apagado.';
  END IF;

  IF NOT v_confirmo THEN
    RAISE NOTICE 'Conferencia: % empresa(s) e % profile(s) sem login seriam apagados. Troque false por true para apagar.',
      cardinality(v_empresas), cardinality(v_perfis);
    RETURN;
  END IF;

  -- quadro, fluxo, campanha e conexao apontam para a empresa por escopo + owner_id (sem chave estrangeira)
  DELETE FROM public.crm_quadros WHERE escopo = 'parceiro' AND owner_id = ANY (v_empresas);
  DELETE FROM public.bot_fluxos WHERE escopo = 'parceiro' AND owner_id = ANY (v_empresas);
  DELETE FROM public.bot_disparos WHERE escopo = 'parceiro' AND owner_id = ANY (v_empresas);
  DELETE FROM public.partners WHERE id = ANY (v_empresas);   -- membros, fuso e relatorios saem em cascata
  DELETE FROM public.profiles WHERE id = ANY (v_perfis) AND user_id IS NULL;
  RAISE NOTICE 'Apagado: % empresa(s) e % profile(s) sem login.', cardinality(v_empresas), cardinality(v_perfis);
END
$sementes$;

-- PARTE 3: o que sobrou (so le). Depois de apagar: as duas linhas tem que dar 0. -----------------
SELECT (SELECT count(*) FROM public.profiles WHERE user_id IS NULL) AS profiles_sem_login,
       (SELECT count(*) FROM public.partners p LEFT JOIN public.profiles dono ON dono.id = p.profile_id
         WHERE dono.id IS NULL OR dono.user_id IS NULL) AS empresas_sem_dono_com_login,
       (SELECT count(*) FROM public.profiles WHERE user_id IS NOT NULL) AS profiles_com_login;
