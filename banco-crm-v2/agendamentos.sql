-- ============================================================
-- Agendamentos do CRM (C11): pg_cron -> pg_net -> rotas /api/cron/* da Vercel.
-- Nada de cron no vercel.json; quem decide o que fazer (fuso de cada empresa,
-- lotes devidos, consentimento) e a rota, nao o horario daqui.
--
-- O Erick roda UMA vez no SQL Editor do Supabase, depois da 003:
--   1. Database > Extensions: ligar pg_cron e pg_net (ou deixar os CREATE abaixo).
--   2. Guardar no Vault a URL do CRM e o CRON_SECRET (o MESMO valor da variavel
--      CRON_SECRET da Vercel). Troque os dois textos e rode so estas linhas:
--        select vault.create_secret('https://SEU-CRM.vercel.app', 'crm_url_base');
--        select vault.create_secret('COLE-AQUI-O-CRON_SECRET', 'crm_cron_secret');
--      Para trocar depois: select vault.update_secret(id, 'novo valor') from vault.secrets where name = '...';
--   3. Rodar este arquivo inteiro. Pode rodar de novo: os jobs sao recriados.
--
-- Conferir: select jobname, schedule, active from cron.job where jobname like 'crm-%';
--           select * from net._http_response order by created desc limit 20;
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- POST na rota com o segredo do Vault. O segredo nunca fica escrito aqui.
CREATE OR REPLACE FUNCTION public.crm_chamar_cron(_rota text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_url text; v_segredo text;
BEGIN
  IF _rota NOT IN ('exportar', 'ia-enviar', 'ia-coletar', 'manutencao', 'ler-comprovantes') THEN
    RAISE EXCEPTION 'rota de cron desconhecida: %', _rota;
  END IF;
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'crm_url_base';
  SELECT decrypted_secret INTO v_segredo FROM vault.decrypted_secrets WHERE name = 'crm_cron_secret';
  IF v_url IS NULL OR v_segredo IS NULL THEN
    RAISE EXCEPTION 'faltam os segredos crm_url_base e crm_cron_secret no Vault';
  END IF;
  RETURN net.http_post(
    url := rtrim(v_url, '/') || '/api/cron/' || _rota,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_segredo),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
END $$;
REVOKE ALL ON FUNCTION public.crm_chamar_cron(text) FROM PUBLIC, anon, authenticated;

DO $agenda$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job
   WHERE jobname IN ('crm-exportar', 'crm-ia-enviar', 'crm-ia-coletar', 'crm-manutencao',
                     'crm-exportar-conversas', 'crm-liberar-reservas', 'crm-ler-comprovantes');
  -- lotes do dia anterior: a rota so gera para quem ja passou das 04:30 no proprio fuso
  PERFORM cron.schedule('crm-exportar', '*/15 * * * *', $$ SELECT public.crm_chamar_cron('exportar') $$);
  -- envio ao Batch dos lotes prontos (motor api_batch com consentimento), de hora em hora
  PERFORM cron.schedule('crm-ia-enviar', '7 * * * *', $$ SELECT public.crm_chamar_cron('ia-enviar') $$);
  -- coleta dos resultados do Batch
  PERFORM cron.schedule('crm-ia-coletar', '*/30 * * * *', $$ SELECT public.crm_chamar_cron('ia-coletar') $$);
  -- reservas vencidas e retencao (corpo 180d, txt 30d, payload 90d)
  -- leitura dos comprovantes pela IA (pista para o mentorado; so empresas com consentimento da IA)
  PERFORM cron.schedule('crm-ler-comprovantes', '*/15 * * * *', $$ SELECT public.crm_chamar_cron('ler-comprovantes') $$);
  PERFORM cron.schedule('crm-manutencao', '*/15 * * * *', $$ SELECT public.crm_chamar_cron('manutencao') $$);
END
$agenda$;
