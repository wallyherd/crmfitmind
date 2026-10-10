-- 005 — Achados da revisao N7 (tarefa N8). Idempotente. Roda depois da 004.
-- Secoes:
--   1. O navegador nao muda o dono de quadro, campanha e fluxo (achado 2)
--   2. ia_relatorios_diarios: o texto e os ids de lote saem do navegador (achados 3 e 5)
--   3. LGPD: arquivo do Storage pendente, o resto da pessoa e o lote do dia (achados 8, 9 e 18)
--   4. mentor_painel: alertas sem ruido (achado 11)
-- Rodar a 001, a 002, a 003 ou a 004 de novo reabre o que esta aqui: rode a 005 de novo logo depois.

BEGIN;

-- 1. Dono de quadro, campanha e fluxo ----------------------------------------
-- O conteudo (cartoes, atividades, alvos) e protegido pelo escopo e pelo dono do quadro ou da campanha.
-- O admin passa na policy de ESTRUTURA e podia trocar escopo/owner_id para o dele e ler tudo. So o servidor
-- e as funcoes do banco (que nao rodam como authenticated) mudam o dono.
CREATE OR REPLACE FUNCTION public.travar_dono_do_conteudo() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND (NEW.escopo IS DISTINCT FROM OLD.escopo OR NEW.owner_id IS DISTINCT FROM OLD.owner_id) THEN
    RAISE EXCEPTION 'escopo e dono nao mudam pelo navegador' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DO $dono005$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_quadros', 'bot_disparos', 'bot_fluxos'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS travar_dono ON public.%I', t);
    EXECUTE format('CREATE TRIGGER travar_dono BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.travar_dono_do_conteudo()', t);
  END LOOP;
END
$dono005$;

-- 2. Relatorio diario -----------------------------------------------------------
-- A linha (numeros) continua visivel ao admin. Saem do navegador: leads_analisados (nome e telefone), o texto
-- do resumo (cita primeiro nome e o que a pessoa disse) e lote_id/analise_id (o admin criava um token da
-- rotina e usava esses ids para sondar o texto das conversas). A tela le o texto por /api/relatorios/dia.
-- Coluna nova so aparece para o navegador depois de rodar este bloco de novo.
DO $relatorio005$
DECLARE v_cols text;
BEGIN
  REVOKE SELECT ON public.ia_relatorios_diarios FROM anon, authenticated;
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO v_cols
    FROM pg_attribute WHERE attrelid = 'public.ia_relatorios_diarios'::regclass AND attnum > 0 AND NOT attisdropped
     AND attname NOT IN ('leads_analisados', 'resumo', 'resumo_executivo', 'pontos_melhoria', 'lote_id', 'analise_id');
  EXECUTE format('GRANT SELECT (%s) ON public.ia_relatorios_diarios TO authenticated', v_cols);
END
$relatorio005$;

-- 3. LGPD ---------------------------------------------------------------------------
-- O arquivo do Storage so sai depois do COMMIT, e o servidor pode falhar ou ser cortado ali. O lote fica
-- marcado como pendente ate alguem confirmar que o arquivo saiu; a manutencao tenta de novo.
ALTER TABLE public.ia_lotes ADD COLUMN IF NOT EXISTS arquivo_apagar_pendente_em timestamptz;

CREATE OR REPLACE FUNCTION public.lgpd_apagar_contato(_contato_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  k contatos%ROWTYPE; v_convs uuid[]; v_cartoes uuid[]; v_arquivos text[] := '{}'; l record; v_chaves text[];
  v_conexoes uuid[]; v_nome text; v_rx text; v_alvos int; v_grupos int; v_expirados int := 0;
BEGIN
  SELECT * INTO k FROM contatos WHERE id = _contato_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('apagado', false); END IF;
  v_conexoes := ARRAY(SELECT id FROM bot_conexoes WHERE escopo = 'parceiro' AND owner_id = k.partner_id);
  -- inclui a conversa que ainda nao foi ligada ao contato (LID sem telefone, privacidade "ignorar")
  v_convs := ARRAY(SELECT id FROM bot_conversas WHERE contato_id = k.id
                   UNION SELECT cv.id FROM bot_conversas cv
                          WHERE cv.contato_id IS NULL AND cv.conexao_id = ANY (v_conexoes) AND cv.tipo = 'individual'
                            AND ((k.telefone IS NOT NULL AND cv.telefone = k.telefone)
                                 OR (k.jid IS NOT NULL AND (cv.jid = k.jid OR cv.lid = k.jid))));
  v_cartoes := ARRAY(
    SELECT ca.id FROM crm_cartoes ca JOIN crm_quadros q ON q.id = ca.quadro_id AND q.escopo = 'parceiro' AND q.owner_id = k.partner_id
     WHERE ca.contato_id = k.id OR (k.telefone IS NOT NULL AND ca.contato_telefone = k.telefone)
    UNION SELECT cartao_id FROM bot_conversas WHERE id = ANY (v_convs) AND cartao_id IS NOT NULL);

  FOR l IN SELECT id, refs, arquivo_path, arquivo_apagado_em, status FROM ia_lotes WHERE partner_id = k.partner_id LOOP
    v_chaves := ARRAY(SELECT e.key FROM jsonb_each(l.refs) e WHERE position('.' IN e.key) = 0
                        AND (e.value->>'contato_id' = k.id::text OR (e.value->>'conversa_id')::uuid = ANY (v_convs)));
    CONTINUE WHEN cardinality(v_chaves) = 0;
    -- o arquivo tem a conversa da pessoa: sai do ar ja (410 para quem pedir) e fica pendente ate o servidor confirmar.
    -- Lote que ainda nao foi analisado perde o arquivo e o dia inteiro ficaria sem analise: expira, e o ciclo
    -- seguinte (crm_lotes_devidos) monta uma versao nova do dia, ja sem a pessoa.
    UPDATE ia_lotes SET refs = (SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}') FROM jsonb_each(l.refs) e
                                 WHERE split_part(e.key, '.', 1) <> ALL (v_chaves)),
           arquivo_apagado_em = COALESCE(arquivo_apagado_em, now()),
           arquivo_apagar_pendente_em = COALESCE(arquivo_apagar_pendente_em, now()),
           status = CASE WHEN status IN ('pronto', 'reservado') THEN 'expirado' ELSE status END,
           reserva_id = CASE WHEN status IN ('pronto', 'reservado') THEN NULL ELSE reserva_id END,
           reservado_ate = CASE WHEN status IN ('pronto', 'reservado') THEN NULL ELSE reservado_ate END
     WHERE id = l.id;
    IF l.status IN ('pronto', 'reservado') THEN v_expirados := v_expirados + 1; END IF;
    IF l.arquivo_apagado_em IS NULL THEN v_arquivos := v_arquivos || l.arquivo_path; END IF;
    UPDATE ia_analises SET payload = jsonb_set(payload, '{contatos}', COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(payload->'contatos') e
                                     WHERE NOT (e->>'ref' = ANY (v_chaves))), '[]'))
     WHERE lote_id = l.id AND jsonb_typeof(payload->'contatos') = 'array';
  END LOOP;
  UPDATE ia_analises SET leads = (SELECT COALESCE(jsonb_agg(e), '[]') FROM jsonb_array_elements(leads) e
                                   WHERE e->>'contato_id' IS DISTINCT FROM k.id::text)
   WHERE partner_id = k.partner_id AND jsonb_typeof(leads) = 'array';
  UPDATE ia_relatorios_diarios SET leads_analisados = (SELECT COALESCE(jsonb_agg(e), '[]') FROM jsonb_array_elements(leads_analisados) e
                                   WHERE e->>'contato_id' IS DISTINCT FROM k.id::text)
   WHERE partner_id = k.partner_id AND jsonb_typeof(leads_analisados) = 'array';

  -- o resumo do dia cita o primeiro nome da pessoa: troca por um marcador
  v_nome := crm_primeiro_nome(k.nome);
  IF k.nome IS NOT NULL AND v_nome <> 'Contato' AND length(v_nome) >= 2 THEN
    v_rx := '\m' || regexp_replace(v_nome, '([][\\.^$|?*+(){}])', '\\\1', 'g') || '\M';
    UPDATE ia_relatorios_diarios SET
           resumo = CASE WHEN resumo IS NULL THEN NULL ELSE regexp_replace(resumo::text, v_rx, '[pessoa removida]', 'gi')::jsonb END,
           resumo_executivo = regexp_replace(resumo_executivo, v_rx, '[pessoa removida]', 'gi'),
           pontos_melhoria = regexp_replace(pontos_melhoria, v_rx, '[pessoa removida]', 'gi')
     WHERE partner_id = k.partner_id;
    UPDATE ia_analises SET payload = jsonb_set(payload, '{resumo}', regexp_replace((payload->'resumo')::text, v_rx, '[pessoa removida]', 'gi')::jsonb)
     WHERE partner_id = k.partner_id AND payload ? 'resumo';
  END IF;

  DELETE FROM ia_sugestoes WHERE contato_id = k.id;
  DELETE FROM ia_feedback WHERE contato_id = k.id;
  DELETE FROM tarefas_followup WHERE contato_id = k.id;
  -- a venda fica (e dinheiro do mentorado), sem nada que identifique a pessoa
  UPDATE vendas SET contato_id = NULL, conversa_id = NULL, cartao_id = NULL, evidencia_mensagem_id = NULL,
         evidencia_trecho = NULL, updated_at = now()
   WHERE contato_id = k.id OR conversa_id = ANY (v_convs);
  -- alvos de campanha guardam telefone e nome
  DELETE FROM bot_disparo_alvos
   WHERE disparo_id IN (SELECT id FROM bot_disparos WHERE escopo = 'parceiro' AND owner_id = k.partner_id)
     AND ((k.telefone IS NOT NULL AND telefone = k.telefone) OR cartao_id = ANY (v_cartoes));
  GET DIAGNOSTICS v_alvos = ROW_COUNT;
  -- o que ela escreveu em grupos: a mensagem fica (e dos outros), sem texto, midia nem identificacao dela
  UPDATE bot_mensagens SET corpo = NULL, midia = NULL, participante_jid = NULL, participante_telefone = NULL, participante_nome = NULL
   WHERE conversa_id IN (SELECT id FROM bot_conversas WHERE conexao_id = ANY (v_conexoes) AND tipo = 'grupo')
     AND ((k.telefone IS NOT NULL AND (participante_telefone = k.telefone OR lower(participante_jid) = k.telefone || '@s.whatsapp.net'))
          OR (k.jid IS NOT NULL AND lower(participante_jid) = lower(k.jid)));
  GET DIAGNOSTICS v_grupos = ROW_COUNT;
  DELETE FROM crm_cartao_etiquetas WHERE cartao_id = ANY (v_cartoes);
  DELETE FROM crm_atividades WHERE cartao_id = ANY (v_cartoes);
  UPDATE bot_conversas SET cartao_id = NULL WHERE cartao_id = ANY (v_cartoes);
  DELETE FROM crm_cartoes WHERE id = ANY (v_cartoes);
  DELETE FROM bot_mensagens WHERE conversa_id = ANY (v_convs);
  DELETE FROM bot_conversas WHERE id = ANY (v_convs);
  DELETE FROM wa_contatos_base WHERE conexao_id = ANY (v_conexoes)
     AND ((k.telefone IS NOT NULL AND (telefone = k.telefone OR jid = k.telefone || '@s.whatsapp.net'))
          OR (k.jid IS NOT NULL AND (jid = k.jid OR lid = k.jid)));
  DELETE FROM contatos WHERE id = k.id;
  RETURN jsonb_build_object('apagado', true, 'conversas', cardinality(v_convs), 'cartoes', cardinality(v_cartoes),
                            'alvos', v_alvos, 'mensagens_de_grupo', v_grupos, 'lotes_refeitos', v_expirados,
                            'arquivos', to_jsonb(v_arquivos));
END $$;

-- Retencao: alem dos arquivos com mais de 30 dias, devolve os pendentes da LGPD (o servidor tenta apagar de novo).
CREATE OR REPLACE FUNCTION public.crm_retencao() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n_corpo int; n_payload int; n_rel int; n_venda int;
BEGIN
  UPDATE bot_mensagens SET corpo = NULL, midia = NULLIF(midia - 'nomeArquivo', '{}'::jsonb)
   WHERE momento < now() - interval '180 days' AND (corpo IS NOT NULL OR midia ? 'nomeArquivo');
  GET DIAGNOSTICS n_corpo = ROW_COUNT;
  UPDATE vendas SET evidencia_trecho = NULL WHERE created_at < now() - interval '180 days' AND evidencia_trecho IS NOT NULL;
  GET DIAGNOSTICS n_venda = ROW_COUNT;
  UPDATE ia_analises SET payload = '{}'::jsonb, leads = NULL, payload_apagado_em = now()
   WHERE created_at < now() - interval '90 days' AND payload_apagado_em IS NULL;
  GET DIAGNOSTICS n_payload = ROW_COUNT;
  UPDATE ia_relatorios_diarios SET leads_analisados = '[]'::jsonb
   WHERE data_referencia < current_date - 90 AND leads_analisados IS DISTINCT FROM '[]'::jsonb;
  GET DIAGNOSTICS n_rel = ROW_COUNT;
  RETURN jsonb_build_object('corpos', n_corpo, 'trechos_venda', n_venda, 'payloads', n_payload, 'relatorios', n_rel,
    'arquivos', COALESCE((SELECT jsonb_agg(arquivo_path ORDER BY created_at) FROM ia_lotes
                           WHERE status <> 'gerando'
                             AND ((created_at < now() - interval '30 days' AND arquivo_apagado_em IS NULL)
                                  OR arquivo_apagar_pendente_em IS NOT NULL)), '[]'));
END $$;

-- Confirma que o arquivo saiu do Storage: marca como apagado e limpa a pendencia.
CREATE OR REPLACE FUNCTION public.ia_marcar_arquivos_apagados(_caminhos text[]) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH x AS (UPDATE public.ia_lotes SET arquivo_apagado_em = COALESCE(arquivo_apagado_em, now()), arquivo_apagar_pendente_em = NULL
              WHERE arquivo_path = ANY (_caminhos) AND (arquivo_apagado_em IS NULL OR arquivo_apagar_pendente_em IS NOT NULL) RETURNING 1)
  SELECT count(*)::int FROM x
$$;

-- Funcoes novas e reescritas: o navegador nao as executa (CREATE OR REPLACE mantem o que a 003 revogou;
-- a funcao nova de gatilho dispara sem EXECUTE).
REVOKE ALL ON FUNCTION public.travar_dono_do_conteudo() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.travar_dono_do_conteudo() TO service_role;

-- 4. mentor_painel ------------------------------------------------------------------
-- conexao_sem_sinal so conta o gateway ja pareado (o conector do PC desligado a noite e normal, e a conexao
-- nunca pareada nao tem sinal para perder); sem_conversa_2_dias so vale para empresa com conexao.
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
                 AND cx.modo = 'gateway' AND cx.numero IS NOT NULL
                 AND (cx.visto_em IS NULL OR cx.visto_em < now() - interval '10 minutes')) AS sem_sinal,
      EXISTS (SELECT 1 FROM bot_conexoes cx
               WHERE cx.escopo = 'parceiro' AND cx.owner_id = b.id AND cx.arquivado_em IS NULL AND cx.desconectada_em IS NULL) AS tem_conexao,
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
      CASE WHEN f.tem_conexao AND (f.ultima IS NULL OR f.ultima < f.ref - interval '2 days') THEN 'sem_conversa_2_dias' END,
      CASE WHEN f.a_confirmar > 5 THEN 'vendas_a_confirmar' END,
      CASE WHEN f.expira_em IS NOT NULL AND f.expira_em < now() + interval '7 days' THEN 'acesso_vencendo' END
    ], NULL)
    FROM final f
   ORDER BY f.fantasy_name, f.id
$$;

COMMIT;
