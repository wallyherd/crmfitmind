-- Diagnóstico do banco no ar (somente leitura).
-- Cole no SQL Editor do Supabase e rode. Devolve UMA linha com um JSON:
-- estrutura das tabelas, RLS, policies, funções, gatilhos, extensões e contagens.
-- Não lê nenhum dado pessoal nem segredo (nada de senha, telefone, mensagem ou chave).
-- Copie o valor da coluna "diagnostico" e mande de volta.

SELECT json_build_object(
  'gerado_em', now(),
  'versao_postgres', current_setting('server_version'),
  'extensoes', (SELECT json_agg(extname ORDER BY extname) FROM pg_extension),
  'tabelas', (
    SELECT json_object_agg(c.relname, json_build_object(
      'rls', c.relrowsecurity,
      'colunas', (
        SELECT json_agg(json_build_object(
                 'nome', a.attname,
                 'tipo', format_type(a.atttypid, a.atttypmod),
                 'nulo', NOT a.attnotnull,
                 'padrao', pg_get_expr(d.adbin, d.adrelid))
               ORDER BY a.attnum)
        FROM pg_attribute a
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
      'restricoes', (
        SELECT json_agg(json_build_object('nome', conname, 'def', pg_get_constraintdef(oid)))
        FROM pg_constraint WHERE conrelid = c.oid),
      'indices', (
        SELECT json_agg(pg_get_indexdef(indexrelid)) FROM pg_index WHERE indrelid = c.oid)))
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'),
  'policies', (
    SELECT json_agg(json_build_object(
             'tabela', tablename, 'nome', policyname, 'cmd', cmd, 'papeis', roles,
             'using', qual, 'check', with_check) ORDER BY tablename, policyname)
    FROM pg_policies WHERE schemaname = 'public'),
  'funcoes', (
    SELECT json_agg(json_build_object(
             'nome', p.proname,
             'args', pg_get_function_identity_arguments(p.oid),
             'security_definer', p.prosecdef,
             'md5', md5(p.prosrc),
             'execute_anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
             'execute_authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'))
           ORDER BY p.proname)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'),
  'gatilhos', (
    SELECT json_agg(json_build_object('tabela', event_object_schema || '.' || event_object_table,
                                      'nome', trigger_name, 'quando', action_timing,
                                      'evento', event_manipulation))
    FROM information_schema.triggers
    WHERE event_object_schema IN ('public', 'auth')),
  'grants_bot_conexoes_webhook_segredo', (
    SELECT json_build_object(
      'anon', has_column_privilege('anon', 'public.bot_conexoes', 'webhook_segredo', 'SELECT'),
      'authenticated', has_column_privilege('authenticated', 'public.bot_conexoes', 'webhook_segredo', 'SELECT'))
    WHERE EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'bot_conexoes'
                    AND column_name = 'webhook_segredo')),
  -- contagens por SQL dinâmico: tabela ou coluna que não existir vira null em vez de derrubar a consulta
  'contagens', (
    SELECT json_object_agg(nome, CASE WHEN existe
      THEN (xpath('/row/c/text()', query_to_xml(sql, false, true, '')))[1]::text::bigint END)
    FROM (VALUES
      ('auth_users',           to_regclass('auth.users') IS NOT NULL,             'select count(*) as c from auth.users'),
      ('profiles',             to_regclass('public.profiles') IS NOT NULL,        'select count(*) as c from public.profiles'),
      ('profiles_sem_user_id', EXISTS (SELECT 1 FROM information_schema.columns
                                       WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'user_id'),
                                                                                  'select count(*) as c from public.profiles where user_id is null'),
      ('partners',             to_regclass('public.partners') IS NOT NULL,        'select count(*) as c from public.partners'),
      ('partner_members',      to_regclass('public.partner_members') IS NOT NULL, 'select count(*) as c from public.partner_members'),
      ('bot_conexoes',         to_regclass('public.bot_conexoes') IS NOT NULL,    'select count(*) as c from public.bot_conexoes'),
      ('bot_conversas',        to_regclass('public.bot_conversas') IS NOT NULL,   'select count(*) as c from public.bot_conversas'),
      ('bot_mensagens',        to_regclass('public.bot_mensagens') IS NOT NULL,   'select count(*) as c from public.bot_mensagens'),
      ('crm_quadros',          to_regclass('public.crm_quadros') IS NOT NULL,     'select count(*) as c from public.crm_quadros'),
      ('crm_cartoes',          to_regclass('public.crm_cartoes') IS NOT NULL,     'select count(*) as c from public.crm_cartoes')
    ) AS t(nome, existe, sql)),
  'storage_buckets', CASE WHEN to_regclass('storage.buckets') IS NOT NULL
    THEN query_to_xml('select id, public from storage.buckets', false, true, '')::text END,
  'cron_jobs', CASE WHEN to_regclass('cron.job') IS NOT NULL
    THEN query_to_xml('select jobname, schedule from cron.job', false, true, '')::text END
) AS diagnostico;
