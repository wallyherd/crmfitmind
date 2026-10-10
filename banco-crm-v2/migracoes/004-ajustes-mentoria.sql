-- 004 — Ajustes da mentoria. Idempotente. Roda depois da 003.
-- Seções:
--   1. Fuso padrão Cuiabá-MT (N1)
--   2. Mentor: privacidade e painel (N4)

BEGIN;

-- 1. Fuso padrão Cuiabá-MT ------------------------------------------------
-- A conversao das linhas so roda na primeira vez (marca no comentario da coluna): rodar a 004 de novo
-- nao desfaz um America/Sao_Paulo escolhido de proposito depois.
DO $fuso004$
BEGIN
  IF COALESCE(col_description('public.partner_acesso_config'::regclass,
                              (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.partner_acesso_config'::regclass AND attname = 'timezone')), '')
     NOT LIKE '%fuso-cuiaba-004%' THEN
    UPDATE public.partner_acesso_config SET timezone = 'America/Cuiaba' WHERE timezone = 'America/Sao_Paulo';
    COMMENT ON COLUMN public.partner_acesso_config.timezone IS 'Fuso da empresa (IANA). fuso-cuiaba-004: linhas de Sao Paulo ja convertidas.';
  END IF;
END
$fuso004$;
ALTER TABLE public.partner_acesso_config ALTER COLUMN timezone SET DEFAULT 'America/Cuiaba';

-- O instalador novo ja usa Cuiaba quando a empresa nao tem fuso configurado; num banco que ja existe a funcao
-- continuava com Sao Paulo (achado do teste 10-banco-no-ar). Mesma assinatura e mesmos privilegios (REPLACE preserva).
CREATE OR REPLACE FUNCTION public.bot_dia_da_conexao(_conexao_id uuid)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (now() AT TIME ZONE COALESCE(
           (SELECT cfg.timezone FROM public.partner_acesso_config cfg
             JOIN public.bot_conexoes c ON c.owner_id = cfg.partner_id
            WHERE c.id = _conexao_id),
           'America/Cuiaba'))::date;
$function$;

-- 2. Mentor: privacidade e painel (N4) ------------------------------------
-- O admin (mentor) ve numeros, resumo do dia, status das conexoes e as empresas.
-- Conteudo (mensagens, nomes, telefones, cartoes, vendas, lotes, analises,
-- sugestoes) so com o opt-in do dono da empresa.

ALTER TABLE public.partner_acesso_config
  ADD COLUMN IF NOT EXISTS mentor_pode_ver_conversas boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mentor_pode_ver_conversas_em timestamptz;

-- So a parte do membro (dono ou permissao), sem o atalho do admin.
CREATE OR REPLACE FUNCTION public.partner_membro_pode(_partner_id uuid, _permissao text)
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
  ), false)
$function$;

-- Mesmo resultado de antes (membro ou admin), agora sobre partner_membro_pode.
CREATE OR REPLACE FUNCTION public.partner_pode(_partner_id uuid, _permissao text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.partner_membro_pode(_partner_id, _permissao) OR COALESCE(public.is_admin(auth.uid()), false)
$function$;

CREATE OR REPLACE FUNCTION public.pode_ver_conteudo(_partner_id uuid, _permissao text DEFAULT 'crm')
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.partner_membro_pode(_partner_id, _permissao)
      OR (COALESCE(public.is_admin(auth.uid()), false)
          AND COALESCE((SELECT c.mentor_pode_ver_conversas FROM public.partner_acesso_config c
                         WHERE c.partner_id = _partner_id), false))
$function$;

-- Conteudo de um dono (conexao, campanha, quadro). Coach e profissional nao
-- tem opt-in: ali o admin nao tem atalho, so o proprio dono ve.
CREATE OR REPLACE FUNCTION public.conteudo_do_dono(_escopo text, _owner_id uuid, _permissao text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(CASE _escopo
    WHEN 'parceiro' THEN public.pode_ver_conteudo(_owner_id, _permissao)
    WHEN 'coach' THEN EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = _owner_id AND pr.user_id = auth.uid())
    WHEN 'profissional' THEN EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = _owner_id AND pr.user_id = auth.uid())
    WHEN 'admin' THEN COALESCE(public.is_admin(auth.uid()), false)
    ELSE false
  END, false)
$function$;

CREATE OR REPLACE FUNCTION public.bot_conteudo_conexao(_conexao_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT public.conteudo_do_dono(c.escopo, c.owner_id, 'robo')
                     FROM public.bot_conexoes c WHERE c.id = _conexao_id), false)
$function$;

CREATE OR REPLACE FUNCTION public.crm_conteudo_quadro(_quadro_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT public.conteudo_do_dono(q.escopo, q.owner_id, 'crm')
                     FROM public.crm_quadros q WHERE q.id = _quadro_id), false)
$function$;

-- Estrutura (conexao, fluxo, campanha, quadro, colunas): o admin continua vendo,
-- como antes. Reescritas sobre conteudo_do_dono para a regra morar num lugar so.
CREATE OR REPLACE FUNCTION public.bot_acesso_dono(_escopo text, _owner_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(public.is_admin(auth.uid()), false) OR public.conteudo_do_dono(_escopo, _owner_id, 'robo')
$function$;

CREATE OR REPLACE FUNCTION public.crm_acesso_quadro(_quadro_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.crm_conteudo_quadro(_quadro_id) OR COALESCE(public.is_admin(auth.uid()), false)
$function$;

-- Importar grava cartoes e conta os repetidos por telefone (da para sondar
-- se um numero esta no funil): e conteudo.
CREATE OR REPLACE FUNCTION public.crm_importar_contatos(_quadro_id uuid, _contatos jsonb, _origem text DEFAULT 'importacao'::text, _coluna_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(criados integer, ignorados integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_coluna uuid; v_pos double precision; v_criados int := 0; v_ignorados int := 0; c jsonb; v_tel text; v_nome text;
BEGIN
  IF NOT public.crm_conteudo_quadro(_quadro_id) THEN RAISE EXCEPTION 'Sem acesso a este quadro'; END IF;
  v_coluna := COALESCE(_coluna_id, (SELECT id FROM public.crm_colunas WHERE quadro_id = _quadro_id ORDER BY posicao LIMIT 1));
  IF v_coluna IS NULL THEN RAISE EXCEPTION 'Este quadro nao tem nenhuma etapa. Crie uma antes de importar.'; END IF;
  SELECT COALESCE(MAX(posicao),0) INTO v_pos FROM public.crm_cartoes WHERE coluna_id = v_coluna;
  FOR c IN SELECT * FROM jsonb_array_elements(_contatos) LOOP
    v_tel := NULLIF(regexp_replace(COALESCE(c->>'telefone',''), '\D', '', 'g'), '');
    v_nome := NULLIF(trim(COALESCE(c->>'nome','')), '');
    IF v_nome IS NULL AND v_tel IS NULL THEN v_ignorados := v_ignorados + 1; CONTINUE; END IF;
    IF v_tel IS NOT NULL AND EXISTS (SELECT 1 FROM public.crm_cartoes WHERE quadro_id = _quadro_id AND contato_telefone = v_tel AND arquivado_em IS NULL) THEN
      v_ignorados := v_ignorados + 1; CONTINUE;
    END IF;
    v_pos := v_pos + 1000;
    INSERT INTO public.crm_cartoes (quadro_id, coluna_id, posicao, titulo, contato_nome, contato_telefone, contato_email, origem)
    VALUES (_quadro_id, v_coluna, v_pos, COALESCE(v_nome, v_tel), v_nome, v_tel, NULLIF(trim(COALESCE(c->>'email','')), ''), _origem);
    v_criados := v_criados + 1;
  END LOOP;
  RETURN QUERY SELECT v_criados, v_ignorados;
END; $function$;

-- Tabelas de conteudo: apaga todas as policies e recria, para nao sobrar
-- policy antiga do banco no ar que deixe o admin passar.
DO $conteudo004$
DECLARE
  p record;
  t text;
BEGIN
  FOR p IN
    SELECT policyname, tablename FROM pg_policies
     WHERE schemaname = 'public' AND tablename IN (
       'bot_conversas', 'bot_mensagens', 'wa_contatos_base', 'bot_disparo_alvos',
       'crm_cartoes', 'crm_atividades', 'crm_cartao_etiquetas',
       'contatos', 'vendas', 'tarefas_followup', 'ia_lotes', 'ia_analises', 'ia_sugestoes', 'ia_feedback')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;

  CREATE POLICY "Acesso total via conexao" ON public.bot_conversas AS PERMISSIVE FOR ALL TO authenticated
    USING (public.bot_conteudo_conexao(conexao_id)) WITH CHECK (public.bot_conteudo_conexao(conexao_id));
  CREATE POLICY "Acesso total via conversa" ON public.bot_mensagens AS PERMISSIVE FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.bot_conversas c WHERE c.id = bot_mensagens.conversa_id AND public.bot_conteudo_conexao(c.conexao_id)))
    WITH CHECK (EXISTS (SELECT 1 FROM public.bot_conversas c WHERE c.id = bot_mensagens.conversa_id AND public.bot_conteudo_conexao(c.conexao_id)));
  CREATE POLICY "Ver base de contatos da conexao" ON public.wa_contatos_base FOR SELECT TO authenticated
    USING (public.bot_conteudo_conexao(conexao_id));
  CREATE POLICY "Acesso via disparo" ON public.bot_disparo_alvos AS PERMISSIVE FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.bot_disparos d WHERE d.id = bot_disparo_alvos.disparo_id AND public.conteudo_do_dono(d.escopo, d.owner_id, 'robo')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.bot_disparos d WHERE d.id = bot_disparo_alvos.disparo_id AND public.conteudo_do_dono(d.escopo, d.owner_id, 'robo')));

  CREATE POLICY "Acesso total via quadro" ON public.crm_cartoes AS PERMISSIVE FOR ALL TO authenticated
    USING (public.crm_conteudo_quadro(quadro_id)) WITH CHECK (public.crm_conteudo_quadro(quadro_id));
  CREATE POLICY "Acesso total via cartao" ON public.crm_atividades AS PERMISSIVE FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.crm_cartoes c WHERE c.id = crm_atividades.cartao_id AND public.crm_conteudo_quadro(c.quadro_id)))
    WITH CHECK (EXISTS (SELECT 1 FROM public.crm_cartoes c WHERE c.id = crm_atividades.cartao_id AND public.crm_conteudo_quadro(c.quadro_id)));
  CREATE POLICY "Acesso total via cartao" ON public.crm_cartao_etiquetas AS PERMISSIVE FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.crm_cartoes c WHERE c.id = crm_cartao_etiquetas.cartao_id AND public.crm_conteudo_quadro(c.quadro_id)))
    WITH CHECK (EXISTS (SELECT 1 FROM public.crm_cartoes c WHERE c.id = crm_cartao_etiquetas.cartao_id AND public.crm_conteudo_quadro(c.quadro_id)));

  FOREACH t IN ARRAY ARRAY['contatos', 'vendas', 'tarefas_followup', 'ia_lotes', 'ia_analises', 'ia_sugestoes', 'ia_feedback'] LOOP
    EXECUTE format('CREATE POLICY "Ler da minha empresa" ON public.%I FOR SELECT TO authenticated USING (public.pode_ver_conteudo(partner_id, %L))', t, 'crm');
  END LOOP;
END
$conteudo004$;

-- Relatorio antigo: a linha (numeros e resumo) continua visivel ao admin;
-- leads_analisados (nome, telefone e analise por pessoa) sai do navegador.
-- A tela le pelo servidor (/api/relatorios/dia), nao direto da tabela.
-- Coluna nova so aparece para o navegador depois de rodar este bloco de novo.
DO $relatorio004$
DECLARE v_cols text;
BEGIN
  REVOKE SELECT ON public.ia_relatorios_diarios FROM anon, authenticated;
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO v_cols
    FROM pg_attribute WHERE attrelid = 'public.ia_relatorios_diarios'::regclass AND attnum > 0 AND NOT attisdropped
     AND attname <> 'leads_analisados';
  EXECUTE format('GRANT SELECT (%s) ON public.ia_relatorios_diarios TO authenticated', v_cols);
END
$relatorio004$;

-- So o dono liga ou desliga; desligar vale mesmo com o acesso vencido.
-- Quem chama e o servidor (rota com JWT ja conferida); _profile_id diz quem pediu.
CREATE OR REPLACE FUNCTION public.empresa_definir_privacidade(_partner_id uuid, _profile_id uuid, _mentor_pode_ver boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.partner_acesso_config;
BEGIN
  IF _mentor_pode_ver IS NULL THEN RAISE EXCEPTION 'valor invalido' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM partner_members m JOIN profiles pr ON pr.id = m.profile_id
                  WHERE m.partner_id = _partner_id AND m.profile_id = _profile_id AND m.papel = 'owner'
                    AND (NOT _mentor_pode_ver OR (pr.status = 'ativo' AND (pr.expira_em IS NULL OR pr.expira_em > now())))) THEN
    RAISE EXCEPTION 'so_o_dono' USING ERRCODE = '42501';
  END IF;
  INSERT INTO partner_acesso_config AS c (partner_id, mentor_pode_ver_conversas, mentor_pode_ver_conversas_em)
  VALUES (_partner_id, _mentor_pode_ver, now())
  ON CONFLICT (partner_id) DO UPDATE SET
    mentor_pode_ver_conversas = EXCLUDED.mentor_pode_ver_conversas,
    mentor_pode_ver_conversas_em = CASE WHEN c.mentor_pode_ver_conversas IS DISTINCT FROM EXCLUDED.mentor_pode_ver_conversas
                                        THEN now() ELSE c.mentor_pode_ver_conversas_em END
  RETURNING * INTO r;
  RETURN jsonb_build_object('partner_id', r.partner_id, 'mentor_pode_ver_conversas', r.mentor_pode_ver_conversas,
                            'mentor_pode_ver_conversas_em', r.mentor_pode_ver_conversas_em);
END $$;

-- Painel do mentor: uma linha por empresa ativa, so numeros e estados.
-- Os numeros do dia vem de crm_metricas_dia (nao recalcula). O relatorio
-- olhado e o da vespera: o lote do dia D sai depois das 04:30 de D+1 e a
-- analise tem ate as 08:00. Sem _dia: hoje, no fuso de cada empresa.
CREATE OR REPLACE FUNCTION public.mentor_painel(_dia date DEFAULT NULL)
RETURNS TABLE (partner_id uuid, empresa text, mentorado text, expira_em timestamptz, opt_in boolean, dia date,
               conexoes jsonb, numeros jsonb, metas jsonb, vendas_a_confirmar integer, relatorio jsonb,
               ultima_atividade timestamptz, alertas text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH emp AS (
    SELECT pa.id, pa.fantasy_name, crm_tz(pa.id) AS tz,
           COALESCE(cfg.mentor_pode_ver_conversas, false) AS opt_in, dono.name AS mentorado, dono.expira_em
      FROM partners pa
      LEFT JOIN partner_acesso_config cfg ON cfg.partner_id = pa.id
      LEFT JOIN LATERAL (SELECT pr.name, pr.expira_em FROM partner_members m JOIN profiles pr ON pr.id = m.profile_id
                          WHERE m.partner_id = pa.id AND m.papel = 'owner' ORDER BY m.created_at LIMIT 1) dono ON true
     WHERE pa.status = 'ativo'
  ),
  dias AS (
    SELECT e.*, COALESCE(_dia, (now() AT TIME ZONE e.tz)::date) AS d FROM emp e
  ),
  base AS (
    SELECT x.*, LEAST(now(), (x.d + 1)::timestamp AT TIME ZONE x.tz) AS ref, crm_metricas_dia(x.id, x.d) AS met
      FROM dias x
  ),
  tudo AS (
    SELECT b.*,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', cx.id, 'nome', cx.nome, 'modo', cx.modo, 'status', cx.status, 'visto_em', cx.visto_em,
                'minutos_sem_sinal', floor(extract(epoch FROM now() - cx.visto_em) / 60)::int)
              ORDER BY cx.created_at), '[]'::jsonb)
         FROM bot_conexoes cx
        WHERE cx.escopo = 'parceiro' AND cx.owner_id = b.id AND cx.arquivado_em IS NULL AND cx.desconectada_em IS NULL) AS conexoes,
      EXISTS (SELECT 1 FROM bot_conexoes cx
               WHERE cx.escopo = 'parceiro' AND cx.owner_id = b.id AND cx.arquivado_em IS NULL AND cx.desconectada_em IS NULL
                 AND (cx.visto_em IS NULL OR cx.visto_em < now() - interval '10 minutes')) AS sem_sinal,
      -- mesma regra de crm_lotes_devidos: so ha lote de dia em que ja havia conexao
      EXISTS (SELECT 1 FROM bot_conexoes cx
               WHERE cx.escopo = 'parceiro' AND cx.owner_id = b.id AND cx.arquivado_em IS NULL
                 AND (cx.created_at AT TIME ZONE b.tz)::date <= b.d - 1) AS lote_esperado,
      (SELECT count(*)::int FROM vendas v WHERE v.partner_id = b.id AND v.status = 'pendente_confirmacao') AS a_confirmar,
      (SELECT max(m.momento) FROM bot_mensagens m
         JOIN bot_conversas c ON c.id = m.conversa_id
         JOIN bot_conexoes cx ON cx.id = c.conexao_id AND cx.escopo = 'parceiro' AND cx.owner_id = b.id
        WHERE m.momento <= b.ref AND m.status NOT IN ('pendente', 'erro')) AS ultima,
      r.partes, r.aplicadas, r.analise_erro, r.tem_analise, r.lote_status
      FROM base b
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS partes,
               count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ia_analises a WHERE a.lote_id = l.id AND a.status = 'aplicada'))::int AS aplicadas,
               COALESCE(bool_or(EXISTS (SELECT 1 FROM ia_analises a WHERE a.lote_id = l.id AND a.status = 'erro')), false) AS analise_erro,
               COALESCE(bool_or(EXISTS (SELECT 1 FROM ia_analises a WHERE a.lote_id = l.id)), false) AS tem_analise,
               CASE WHEN count(*) = 0 THEN NULL
                    WHEN bool_or(l.status = 'erro') THEN 'erro'
                    WHEN bool_and(l.status = 'ignorado') THEN 'ignorado'
                    WHEN bool_and(l.status IN ('concluido', 'ignorado')) THEN 'concluido'
                    WHEN bool_or(l.status = 'expirado') THEN 'expirado'
                    WHEN bool_or(l.status = 'gerando') THEN 'gerando'
                    WHEN bool_or(l.status = 'reservado') THEN 'reservado'
                    ELSE 'pronto' END AS lote_status
          FROM ia_lotes l
         WHERE l.partner_id = b.id AND l.dia = b.d - 1
           AND l.versao = (SELECT max(l2.versao) FROM ia_lotes l2 WHERE l2.partner_id = b.id AND l2.dia = b.d - 1)
      ) r ON true
  ),
  final AS (
    SELECT t.*,
      CASE WHEN t.partes > 0 AND t.aplicadas >= t.partes THEN 'aplicada'
           WHEN t.analise_erro THEN 'erro'
           WHEN t.tem_analise THEN 'parcial' END AS analise_status
      FROM tudo t
  )
  SELECT f.id, f.fantasy_name, f.mentorado, f.expira_em, f.opt_in, f.d, f.conexoes,
    jsonb_build_object(
      'medido_em', f.met->'medido_em',
      'novas', f.met->'novas',
      'trafego_pago', f.met#>'{trafego_pago,total}',
      'esperando_voce', f.met->'esperando_voce',
      'cliente_sumiu', f.met->'cliente_sumiu',
      'resposta_mediana_min', f.met#>'{resposta,mediana_min}',
      'resposta_p90_min', f.met#>'{resposta,p90_min}',
      'followups_vencidos', f.met#>'{followups,vencidos}',
      'vendas_confirmado_qtd', f.met#>'{vendas,confirmado_qtd}',
      'vendas_confirmado_valor', f.met#>'{vendas,confirmado_valor}',
      'vendas_a_confirmar_qtd', f.met#>'{vendas,a_confirmar_qtd}',
      'vendas_a_confirmar_valor', f.met#>'{vendas,a_confirmar_valor}',
      'conversao_dia_pct', f.met#>'{conversao,dia_pct}',
      'conversao_coorte7d_pct', f.met#>'{conversao,coorte7d_pct}'),
    COALESCE(f.met->'metas', '[]'::jsonb),
    f.a_confirmar,
    jsonb_build_object('dia', f.d - 1, 'lote', f.lote_status, 'analise', f.analise_status, 'partes', f.partes),
    f.ultima,
    array_remove(ARRAY[
      CASE WHEN f.sem_sinal THEN 'conexao_sem_sinal' END,
      CASE WHEN f.lote_status = 'erro' OR f.analise_status = 'erro' THEN 'analise_com_erro' END,
      CASE WHEN f.lote_esperado AND f.ref >= (f.d::timestamp + time '08:00') AT TIME ZONE f.tz
                AND f.lote_status IS DISTINCT FROM 'ignorado' AND f.lote_status IS DISTINCT FROM 'erro'
                AND f.analise_status IS DISTINCT FROM 'aplicada' AND f.analise_status IS DISTINCT FROM 'erro'
           THEN 'analise_atrasada' END,
      CASE WHEN f.ultima IS NULL OR f.ultima < f.ref - interval '2 days' THEN 'sem_conversa_2_dias' END,
      CASE WHEN f.a_confirmar > 5 THEN 'vendas_a_confirmar' END,
      CASE WHEN f.expira_em IS NOT NULL AND f.expira_em < now() + interval '7 days' THEN 'acesso_vencendo' END
    ], NULL)
    FROM final f
   ORDER BY f.fantasy_name, f.id
$$;

-- Permissoes. As usadas nas policies precisam de EXECUTE para o authenticated;
-- as outras so o servidor executa. crm_pendencias devolve nome, telefone e
-- sugestao e confere so partner_pode (o admin passaria): o navegador nao a
-- chama, a tela usa /api/pendencias.
DO $permissoes004$
DECLARE
  f record;
  de_policy text[] := ARRAY['partner_membro_pode', 'pode_ver_conteudo', 'conteudo_do_dono', 'bot_conteudo_conexao', 'crm_conteudo_quadro'];
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS assinatura, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY (de_policy || ARRAY['empresa_definir_privacidade', 'mentor_painel', 'crm_pendencias'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.assinatura);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.assinatura);
    IF f.proname = ANY (de_policy) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.assinatura);
    END IF;
  END LOOP;
END
$permissoes004$;

COMMIT;
