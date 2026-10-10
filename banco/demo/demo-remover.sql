-- ============================================================================
-- DEMO: apaga tudo o que o demo-criar.sql criou, e só isso.
--
-- Troque UM valor: o mesmo e-mail do mentorado de teste. Tudo ou nada.
-- Só toca no que tem a marca da demo, dentro da empresa desse e-mail:
--   conexão "DEMO ...", telefones 55990000NNNN e o grupo 120363000000000099@g.us,
--   produtos com "[demo]" na descrição, campanha "(demo)", metas desde 2000-01-01,
--   análise/lotes da demo e as etiquetas que a IA criou (cinza #94a3b8) já sem uso.
-- Não apaga a empresa, o usuário, o funil nem as colunas.
-- ============================================================================

DO $demo$
DECLARE
  -- >>>>>>>>>>>>>>>>  TROQUE SÓ ESTA LINHA  <<<<<<<<<<<<<<<<
  v_email constant text := 'TROQUE-PELO-EMAIL-DO-MENTORADO-DE-TESTE';
  -- >>>>>>>>>>>>>>>>  (o resto não precisa de mexida)  <<<<<<<<<<<<<<<<

  v_user uuid; v_prof uuid; v_partner uuid; v_n int;
  v_cx uuid[]; v_contatos uuid[]; v_analises uuid[]; v_lotes uuid[]; v_quadros uuid[];
  c_conv int; c_msg int; c_contatos int; c_vendas int; c_cartoes int; c_lotes int; c_etq int;
BEGIN
  SELECT u.id INTO v_user FROM auth.users u WHERE lower(u.email) = lower(btrim(v_email));
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'DEMO: não existe usuário com o e-mail "%". Troque o e-mail na primeira linha deste arquivo.', v_email;
  END IF;
  SELECT pr.id INTO v_prof FROM public.profiles pr WHERE pr.user_id = v_user;
  SELECT count(*) INTO v_n FROM public.partner_members m WHERE m.profile_id = v_prof AND m.papel = 'owner';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'DEMO: % é dono de % empresas; a remoção só roda quando há exatamente uma.', v_email, v_n;
  END IF;
  SELECT m.partner_id INTO v_partner FROM public.partner_members m WHERE m.profile_id = v_prof AND m.papel = 'owner';

  SELECT COALESCE(array_agg(x.id), '{}') INTO v_cx FROM public.bot_conexoes x
   WHERE x.escopo = 'parceiro' AND x.owner_id = v_partner AND x.nome LIKE 'DEMO %';
  IF cardinality(v_cx) = 0 THEN
    RAISE EXCEPTION 'DEMO: a empresa de % não tem dados de demonstração (não achei a conexão "DEMO ..."). Nada foi apagado.', v_email;
  END IF;

  SELECT COALESCE(array_agg(q.id), '{}') INTO v_quadros FROM public.crm_quadros q
   WHERE q.escopo = 'parceiro' AND q.owner_id = v_partner;

  -- contatos da demo: os das conversas da conexão demo + qualquer um com telefone/grupo da demo
  SELECT COALESCE(array_agg(DISTINCT k.id), '{}') INTO v_contatos FROM public.contatos k
   WHERE k.partner_id = v_partner
     AND (k.telefone ~ '^55990000' OR k.jid = '120363000000000099@g.us'
          OR k.id IN (SELECT c.contato_id FROM public.bot_conversas c WHERE c.conexao_id = ANY (v_cx) AND c.contato_id IS NOT NULL));

  SELECT COALESCE(array_agg(a.id), '{}'), COALESCE(array_agg(DISTINCT a.lote_id), '{}') INTO v_analises, v_lotes
    FROM public.ia_analises a WHERE a.partner_id = v_partner AND a.principal = 'demo';

  SELECT count(*) INTO c_conv FROM public.bot_conversas WHERE conexao_id = ANY (v_cx);
  SELECT count(*) INTO c_msg FROM public.bot_mensagens m JOIN public.bot_conversas c ON c.id = m.conversa_id WHERE c.conexao_id = ANY (v_cx);

  -- vendas, lotes e relatório do dia da demo
  DELETE FROM public.vendas WHERE partner_id = v_partner AND (contato_id = ANY (v_contatos) OR analise_id = ANY (v_analises));
  GET DIAGNOSTICS c_vendas = ROW_COUNT;
  DELETE FROM public.ia_relatorios_diarios WHERE partner_id = v_partner AND (lote_id = ANY (v_lotes) OR analise_id = ANY (v_analises));
  DELETE FROM public.ia_analises WHERE id = ANY (v_analises);
  DELETE FROM public.ia_lotes WHERE partner_id = v_partner AND id = ANY (v_lotes);
  GET DIAGNOSTICS c_lotes = ROW_COUNT;

  -- cartões do funil (atividades e etiquetas saem junto)
  DELETE FROM public.crm_cartoes
   WHERE quadro_id = ANY (v_quadros) AND (contato_id = ANY (v_contatos) OR contato_telefone ~ '^55990000');
  GET DIAGNOSTICS c_cartoes = ROW_COUNT;

  -- conversas e mensagens (e a base de contatos da conexão) saem com a conexão
  DELETE FROM public.bot_conexoes WHERE id = ANY (v_cx);

  -- contatos (tarefas, sugestões e feedback saem junto)
  DELETE FROM public.contatos WHERE id = ANY (v_contatos);
  GET DIAGNOSTICS c_contatos = ROW_COUNT;

  -- etiquetas que a IA criou para a demo e que ninguém mais usa
  DELETE FROM public.crm_etiquetas e
   WHERE e.quadro_id = ANY (v_quadros) AND e.cor = '#94a3b8'
     AND e.nome IN ('demo', 'anuncio', 'pediu_preco', 'comprovante', 'indicacao')
     AND NOT EXISTS (SELECT 1 FROM public.crm_cartao_etiquetas ce WHERE ce.etiqueta_id = e.id);
  GET DIAGNOSTICS c_etq = ROW_COUNT;

  DELETE FROM public.produtos WHERE partner_id = v_partner AND descricao_curta LIKE '[demo]%';
  DELETE FROM public.rastreamento_config WHERE partner_id = v_partner AND nome_campanha LIKE '%(demo)';
  DELETE FROM public.metas_diarias WHERE partner_id = v_partner AND vigente_desde = DATE '2000-01-01';

  RAISE NOTICE 'DEMO removida da empresa de %: % conversas, % mensagens, % contatos, % vendas, % cartões, % lotes, % etiquetas.',
    v_email, c_conv, c_msg, c_contatos, c_vendas, c_cartoes, c_lotes, c_etq;
END
$demo$;
