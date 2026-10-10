-- Conferencia depois de rodar as migracoes (001 a 006). So le: nao muda nada.
-- Cole no SQL Editor e rode. Se tudo estiver certo, termina com "OK: ..." no painel de mensagens.
-- Se algo estiver errado, o bloco falha com a lista do que esta errado (e nada mais roda).
-- Rodar a 001, a 002, a 003 ou a 004 de novo reabre estas travas: rode a 005 e a 006 de novo e esta conferencia.

DO $conferencia$
DECLARE
  v_tabelas text[] := ARRAY['bot_conversas', 'bot_mensagens', 'wa_contatos_base', 'bot_disparo_alvos', 'crm_cartoes',
                            'crm_atividades', 'crm_cartao_etiquetas', 'contatos', 'vendas', 'tarefas_followup',
                            'ia_lotes', 'ia_analises', 'ia_sugestoes', 'ia_feedback'];
  v_erros text[] := '{}';
  r record;
  t text;
BEGIN
  -- 1. toda policy das tabelas de conteudo passa pela guarda do opt-in
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename = ANY (v_tabelas)
       AND NOT (COALESCE(qual, '') || COALESCE(with_check, '') ~ '(pode_ver_conteudo|bot_conteudo_conexao|crm_conteudo_quadro|conteudo_do_dono)')
  LOOP
    v_erros := v_erros || format('policy sem a guarda do opt-in: %s / %s', r.tablename, r.policyname);
  END LOOP;
  FOREACH t IN ARRAY v_tabelas LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t) THEN
      v_erros := v_erros || format('tabela de conteudo sem nenhuma policy (so o servidor le): %s', t);
    END IF;
  END LOOP;

  -- 2. gatilho que trava o dono do conteudo (005)
  FOREACH t IN ARRAY ARRAY['crm_quadros', 'bot_disparos', 'bot_fluxos'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = ('public.' || t)::regclass AND g.tgname = 'travar_dono' AND NOT g.tgisinternal) THEN
      v_erros := v_erros || format('falta o gatilho travar_dono em %s (rode a 005)', t);
    END IF;
  END LOOP;

  -- 3. colunas de texto do relatorio fora do navegador (005)
  FOREACH t IN ARRAY ARRAY['resumo', 'resumo_executivo', 'pontos_melhoria', 'leads_analisados', 'lote_id', 'analise_id'] LOOP
    IF has_column_privilege('authenticated', 'public.ia_relatorios_diarios', t, 'SELECT') THEN
      v_erros := v_erros || format('authenticated le ia_relatorios_diarios.%s (rode a 005)', t);
    END IF;
  END LOOP;

  -- 4. Realtime nao publica tabela de conteudo (quem assina ve a mudanca sem passar pelo servidor)
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOR r IN SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = ANY (v_tabelas) LOOP
      v_erros := v_erros || format('tabela de conteudo na publicacao supabase_realtime: %s', r.tablename);
    END LOOP;
  END IF;

  -- 5. Storage: nenhuma policy abre os buckets conversas-ia e comprovantes ao navegador (so o servidor le)
  --    (a policy RESTRICTIVE da 006 cita 'comprovantes' para FECHAR o bucket: essa pode)
  IF to_regclass('storage.objects') IS NOT NULL THEN
    FOR r IN
      SELECT policyname FROM pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects' AND roles::text ~ '(authenticated|anon|public)'
         AND (qual IS NULL OR qual ~ 'conversas-ia' OR (qual ~ 'comprovantes' AND permissive <> 'RESTRICTIVE')
              OR btrim(qual, '() ') = 'true' OR qual !~ 'bucket_id')
    LOOP
      v_erros := v_erros || format('policy de storage.objects que pode abrir o bucket conversas-ia ou comprovantes: %s', r.policyname);
    END LOOP;
  END IF;

  -- 6. Comprovantes (006). So confere quando a 006 ja foi rodada.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bot_mensagens' AND column_name = 'arquivo_path') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_comprovantes_apagar_mensagem' AND NOT tgisinternal) THEN
      v_erros := v_erros || 'falta o gatilho trg_comprovantes_apagar_mensagem (rode a 006 de novo)';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_bot_conversas_comprovantes' AND NOT tgisinternal) THEN
      v_erros := v_erros || 'falta o gatilho trg_bot_conversas_comprovantes (rode a 006 de novo)';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bot_mensagens' AND column_name = 'comprovante_leitura') THEN
      v_erros := v_erros || 'falta a coluna bot_mensagens.comprovante_leitura (rode a 006 de novo)';
    END IF;
    IF to_regclass('storage.buckets') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'comprovantes' AND public = false) THEN
      v_erros := v_erros || 'o bucket comprovantes nao existe ou esta publico (rode a 006 de novo)';
    END IF;
    FOR t IN SELECT unnest(ARRAY['lgpd_apagar_contato', 'crm_retencao']) LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = t AND p.prosrc ~ 'comprovantes_apagar') THEN
        v_erros := v_erros || format('%s sem os comprovantes: uma migracao antiga a reescreveu, rode a 006 de novo', t);
      END IF;
    END LOOP;
  END IF;

  IF cardinality(v_erros) > 0 THEN
    RAISE EXCEPTION E'Conferencia falhou:\n- %', array_to_string(v_erros, E'\n- ');
  END IF;
  RAISE NOTICE 'OK: policies de conteudo, travas da 005, colunas do relatorio, Realtime, Storage e comprovantes (006) conferidos.';
END
$conferencia$;
