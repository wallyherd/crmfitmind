-- 006 — Comprovantes (tarefa Q1). Idempotente. Roda depois da 005.
-- Guarda o arquivo (imagem ou PDF) que o CLIENTE manda, para o mentorado ver o comprovante na hora de
-- confirmar uma venda. Decisao do Erick: privado, 90 dias. Nunca confirma venda sozinho por causa dele.
-- Secoes:
--   1. Coluna na mensagem e fila de arquivos a apagar
--   2. Bucket privado 'comprovantes' (so o servidor le e grava)
--   3. Funcoes do upload (comprovante_preparar, comprovante_registrar, comprovantes_marcar_apagados)
--   4. LGPD apaga os comprovantes da pessoa
--   5. Retencao de 90 dias
--   6. Permissoes
-- Rodar a 001 a 005 de novo reabre o que esta aqui: rode a 006 de novo logo depois.

BEGIN;

-- 1. Coluna e fila -----------------------------------------------------------------
-- arquivo_path: {partner_id}/{conversa_id}/{mensagem_id}.{ext}, dentro do bucket 'comprovantes'. O navegador so ve
-- o caminho (o bucket e privado); o link vem de GET /api/mensagens/:id/arquivo, com 60 s de vida.
ALTER TABLE public.bot_mensagens
  ADD COLUMN IF NOT EXISTS arquivo_path text,
  ADD COLUMN IF NOT EXISTS arquivo_em timestamptz;
CREATE INDEX IF NOT EXISTS bot_mensagens_arquivo_idx ON public.bot_mensagens (arquivo_em) WHERE arquivo_path IS NOT NULL;

-- Tarefa Q2: leitura do comprovante pela IA (POST /api/cron/ler-comprovantes). So PISTA para o mentorado, nunca
-- confirma venda. A leitura guarda so valor, data, hora, banco (lista fechada) e ID; nome e documento do pagador nao.
-- comprovante_tentativas e RESERVADA antes da chamada paga (o cron desiste na 3a, e duas execucoes ao mesmo tempo
-- nao pagam o mesmo arquivo); comprovante_tentou_em da a cota diaria por empresa.
-- A leitura sai junto com o arquivo (privacidade da conversa e retencao de 90 dias).
ALTER TABLE public.bot_mensagens
  ADD COLUMN IF NOT EXISTS comprovante_leitura jsonb,
  ADD COLUMN IF NOT EXISTS comprovante_lido_em timestamptz,
  ADD COLUMN IF NOT EXISTS comprovante_tentativas smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comprovante_tentou_em timestamptz;
CREATE INDEX IF NOT EXISTS bot_mensagens_comprovante_pendente_idx ON public.bot_mensagens (arquivo_em)
  WHERE arquivo_path IS NOT NULL AND comprovante_lido_em IS NULL;

-- Caminhos que ja nao pertencem a nenhuma mensagem (venceram, a pessoa foi apagada, a conversa virou privada)
-- mas o arquivo ainda pode estar no Storage. Fica aqui ate o servidor confirmar que apagou: se ele cair no meio,
-- a manutencao tenta de novo e nenhum arquivo fica sem dono.
CREATE TABLE IF NOT EXISTS public.comprovantes_apagar (
  caminho text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.comprovantes_apagar ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comprovantes_apagar FROM anon, authenticated;
GRANT ALL ON public.comprovantes_apagar TO service_role;

-- Mensagem apagada por qualquer caminho (LGPD, cascata da conversa ou da conexao): o arquivo vai para a fila.
CREATE OR REPLACE FUNCTION public.comprovantes_ao_apagar_mensagem() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF OLD.arquivo_path IS NOT NULL THEN
    INSERT INTO public.comprovantes_apagar (caminho) VALUES (OLD.arquivo_path) ON CONFLICT DO NOTHING;
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_comprovantes_apagar_mensagem ON public.bot_mensagens;
CREATE TRIGGER trg_comprovantes_apagar_mensagem BEFORE DELETE ON public.bot_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.comprovantes_ao_apagar_mensagem();

-- Conversa marcada como "so metadados" ou "ignorar": o texto ja sai (002); o arquivo tambem.
CREATE OR REPLACE FUNCTION public.comprovantes_ao_mudar_privacidade() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.privacidade <> 'normal' AND NEW.privacidade IS DISTINCT FROM OLD.privacidade THEN
    INSERT INTO public.comprovantes_apagar (caminho)
      SELECT arquivo_path FROM public.bot_mensagens WHERE conversa_id = NEW.id AND arquivo_path IS NOT NULL
      ON CONFLICT DO NOTHING;
    UPDATE public.bot_mensagens SET arquivo_path = NULL, arquivo_em = NULL,
           comprovante_leitura = NULL, comprovante_lido_em = NULL, comprovante_tentativas = 0, comprovante_tentou_em = NULL
     WHERE conversa_id = NEW.id AND arquivo_path IS NOT NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_bot_conversas_comprovantes ON public.bot_conversas;
CREATE TRIGGER trg_bot_conversas_comprovantes AFTER UPDATE OF privacidade ON public.bot_conversas
  FOR EACH ROW EXECUTE FUNCTION public.comprovantes_ao_mudar_privacidade();

-- 2. Bucket privado ------------------------------------------------------------------
-- 4 MB (a Vercel recebe ate ~4,5 MB) e so imagem e PDF. Sem policy para o navegador: so a service role le e grava.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('comprovantes', 'comprovantes', false, 4194304, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 4194304,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

-- Trava explicita (restritiva): mesmo que alguem crie depois uma policy larga em storage.objects, o navegador
-- (anon e authenticated) nao enxerga nem grava neste bucket. A service role ignora a RLS.
DO $pol006$
BEGIN
  DROP POLICY IF EXISTS "comprovantes so o servidor" ON storage.objects;
  CREATE POLICY "comprovantes so o servidor" ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
    USING (bucket_id <> 'comprovantes') WITH CHECK (bucket_id <> 'comprovantes');
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'sem permissao para criar a policy em storage.objects; o bucket continua fechado (sem policy nenhuma para o navegador)';
END
$pol006$;

-- 3. Upload ----------------------------------------------------------------------------
-- Confere tudo o que o gateway pode nao saber e devolve o caminho do arquivo. O gateway nao baixa de grupo nem
-- do que o proprio mentorado manda, mas a trava de verdade e esta (o servidor nao confia no gateway).
-- O caminho usa o uuid da mensagem, nunca o waId: o waId e escolhido por quem envia, e dois waIds diferentes
-- ('ABC.1' e 'ABC_1') davam o mesmo caminho e um sobrescrevia o arquivo do outro.
CREATE OR REPLACE FUNCTION public.comprovante_preparar(_conexao_id uuid, _wa_id text, _chat_jid text, _mimetype text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  cx record; m record; v_ext text;
BEGIN
  SELECT id, escopo, owner_id, arquivado_em INTO cx FROM bot_conexoes WHERE id = _conexao_id;
  IF NOT FOUND OR cx.arquivado_em IS NOT NULL THEN RETURN jsonb_build_object('erro', 'conexao'); END IF;
  IF cx.escopo <> 'parceiro' OR cx.owner_id IS NULL THEN RETURN jsonb_build_object('erro', 'sem_empresa'); END IF;
  v_ext := CASE lower(btrim(split_part(COALESCE(_mimetype, ''), ';', 1)))
             WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp'
             WHEN 'application/pdf' THEN 'pdf' END;
  IF v_ext IS NULL THEN RETURN jsonb_build_object('erro', 'mimetype'); END IF;
  IF COALESCE(_chat_jid, '') LIKE '%@g.us' THEN RETURN jsonb_build_object('erro', 'grupo'); END IF;
  IF btrim(COALESCE(_wa_id, '')) = '' OR length(_wa_id) > 120 THEN RETURN jsonb_build_object('erro', 'mensagem_desconhecida'); END IF;

  -- Pelo waId dentro da conexao, nao pelo chatJid (a conversa pode estar pelo LID ou pelo telefone).
  SELECT ms.id, ms.tipo, ms.direcao, ms.arquivo_path, c.id AS conversa_id, c.tipo AS conversa_tipo, c.privacidade
    INTO m
    FROM bot_mensagens ms JOIN bot_conversas c ON c.id = ms.conversa_id
   WHERE c.conexao_id = _conexao_id AND ms.wa_id = _wa_id
   LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('erro', 'mensagem_desconhecida'); END IF;
  IF m.conversa_tipo <> 'individual' THEN RETURN jsonb_build_object('erro', 'grupo'); END IF;
  IF m.direcao <> 'entrada' THEN RETURN jsonb_build_object('erro', 'de_mim'); END IF;
  IF m.tipo NOT IN ('imagem', 'documento') THEN RETURN jsonb_build_object('erro', 'tipo'); END IF;
  IF m.privacidade <> 'normal' THEN RETURN jsonb_build_object('erro', 'privacidade'); END IF;
  IF m.arquivo_path IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'ja', true, 'mensagemId', m.id); END IF;
  RETURN jsonb_build_object('ok', true, 'mensagemId', m.id,
                            'caminho', cx.owner_id::text || '/' || m.conversa_id::text || '/' || m.id::text || '.' || v_ext);
END $$;

-- Depois do upload: grava o caminho. Confere a privacidade de novo (pode ter mudado durante o upload);
-- se nao gravou, o servidor apaga o arquivo que subiu.
CREATE OR REPLACE FUNCTION public.comprovante_registrar(_mensagem_id uuid, _caminho text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE bot_mensagens ms SET arquivo_path = _caminho, arquivo_em = now()
    FROM bot_conversas c
   WHERE ms.id = _mensagem_id AND c.id = ms.conversa_id AND c.privacidade = 'normal' AND c.tipo = 'individual'
     AND ms.direcao = 'entrada' AND ms.arquivo_path IS NULL;
  RETURN FOUND;
END $$;

-- O servidor confirma que apagou do Storage: sai da fila.
CREATE OR REPLACE FUNCTION public.comprovantes_marcar_apagados(_caminhos text[]) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH x AS (DELETE FROM public.comprovantes_apagar WHERE caminho = ANY (_caminhos) RETURNING 1)
  SELECT count(*)::int FROM x
$$;

-- 4. LGPD ---------------------------------------------------------------------------
-- Igual a da 005, mais a lista dos comprovantes da pessoa (o servidor apaga os arquivos do Storage).
CREATE OR REPLACE FUNCTION public.lgpd_apagar_contato(_contato_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  k contatos%ROWTYPE; v_convs uuid[]; v_cartoes uuid[]; v_arquivos text[] := '{}'; l record; v_chaves text[];
  v_conexoes uuid[]; v_comprovantes text[]; v_nome text; v_rx text; v_alvos int; v_grupos int; v_expirados int := 0;
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
  -- o comprovante que o cliente mandou sai do Storage junto com a pessoa. O gatilho da mensagem ja deixa o
  -- caminho na fila comprovantes_apagar (para o caso de o servidor cair antes de apagar); aqui so devolve a lista.
  v_comprovantes := ARRAY(SELECT arquivo_path FROM bot_mensagens WHERE conversa_id = ANY (v_convs) AND arquivo_path IS NOT NULL);
  DELETE FROM bot_mensagens WHERE conversa_id = ANY (v_convs);
  DELETE FROM bot_conversas WHERE id = ANY (v_convs);
  DELETE FROM wa_contatos_base WHERE conexao_id = ANY (v_conexoes)
     AND ((k.telefone IS NOT NULL AND (telefone = k.telefone OR jid = k.telefone || '@s.whatsapp.net'))
          OR (k.jid IS NOT NULL AND (jid = k.jid OR lid = k.jid)));
  DELETE FROM contatos WHERE id = k.id;
  RETURN jsonb_build_object('apagado', true, 'conversas', cardinality(v_convs), 'cartoes', cardinality(v_cartoes),
                            'alvos', v_alvos, 'mensagens_de_grupo', v_grupos, 'lotes_refeitos', v_expirados,
                            'arquivos', to_jsonb(v_arquivos),
                            'comprovantes_apagar', to_jsonb(COALESCE(v_comprovantes, '{}')));
END $$;

-- 5. Retencao -----------------------------------------------------------------------
-- Igual a da 005 (corpo 180 dias, payload e relatorio 90, arquivos da IA 30), mais os comprovantes com mais de 90 dias
-- e a lista de tudo o que esta na fila de apagar.
CREATE OR REPLACE FUNCTION public.crm_retencao() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n_corpo int; n_payload int; n_rel int; n_venda int; n_comp int;
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
  -- comprovantes: 90 dias depois de guardados o caminho sai da mensagem e vai para a fila de apagar;
  -- o servidor apaga o arquivo do Storage e confirma (comprovantes_marcar_apagados).
  INSERT INTO comprovantes_apagar (caminho)
    SELECT arquivo_path FROM bot_mensagens WHERE arquivo_path IS NOT NULL AND arquivo_em < now() - interval '90 days'
    ON CONFLICT DO NOTHING;
  UPDATE bot_mensagens SET arquivo_path = NULL, arquivo_em = NULL,
         comprovante_leitura = NULL, comprovante_lido_em = NULL, comprovante_tentativas = 0, comprovante_tentou_em = NULL
   WHERE arquivo_path IS NOT NULL AND arquivo_em < now() - interval '90 days';
  GET DIAGNOSTICS n_comp = ROW_COUNT;
  RETURN jsonb_build_object('comprovantes_vencidos', n_comp,
    'comprovantes_apagar', COALESCE((SELECT jsonb_agg(caminho ORDER BY created_at, caminho) FROM comprovantes_apagar), '[]'),
    'corpos', n_corpo, 'trechos_venda', n_venda, 'payloads', n_payload, 'relatorios', n_rel,
    'arquivos', COALESCE((SELECT jsonb_agg(arquivo_path ORDER BY created_at) FROM ia_lotes
                           WHERE status <> 'gerando'
                             AND ((created_at < now() - interval '30 days' AND arquivo_apagado_em IS NULL)
                                  OR arquivo_apagar_pendente_em IS NOT NULL)), '[]'));
END $$;

-- 6. Permissoes -------------------------------------------------------------------------
-- So o servidor executa. Os gatilhos disparam mesmo sem EXECUTE.
DO $permissoes006$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS assinatura
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('comprovante_preparar', 'comprovante_registrar', 'comprovantes_marcar_apagados',
                         'comprovantes_ao_apagar_mensagem', 'comprovantes_ao_mudar_privacidade',
                         'lgpd_apagar_contato', 'crm_retencao')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.assinatura);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.assinatura);
  END LOOP;
END
$permissoes006$;

COMMIT;
