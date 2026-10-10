-- ============================================================
-- 002 - Fase 1: captura completa do WhatsApp (gateway Baileys no VPS
-- ou conector no PC), fila de saida com reserva e robo desligado por padrao.
--
-- Idempotente: pode rodar duas vezes sem erro e sem mudar nada na segunda.
-- Ordem: banco-instalar-completo.sql + banco-retroalimentacao.sql + 001 + esta.
-- Rodar a 001 de novo depois desta nao desfaz nada daqui (a 001 so recria
-- policies das tabelas antigas e nao conhece as funcoes novas).
--
-- Contrato: gateway/CONTRATO.md. Resolucoes da revisao que valem aqui:
--   C3  origem do lead NAO e detectada na captura: so bot_mensagens.anuncio bruto
--   C6  nada de "vacuo" na captura
--   C8  nenhum gatilho de follow-up na captura
--   C16 corpo so e apagado por marcacao manual (privacidade da conversa)
--   V11 lista de conversas do historico, sem corpo, em wa_contatos_base
--
-- O que faz:
--   1. bot_conexoes: modo (gateway|pc), bot_ativo (padrao false), opcoes,
--      pareamento, grupos_disponiveis, desconectada_em
--   2. bot_conversas: tipo, grupo_nome, lid, telefone opcional (LID sem
--      telefone), privacidade, relogios de entrada e de saida humana
--   3. bot_mensagens: hora do WhatsApp, autor, grupo, midia, anuncio, recibos,
--      edicao/apagada e a reserva da fila (tentativas, reservada_ate)
--   4. wa_contatos_base (V11), com RLS
--   5. funcoes: bot_registrar_eventos (lote numa ida ao banco),
--      bot_reservar_fila, bot_confirmar_envio, bot_arquivo_completo e auxiliares
--   6. gatilhos: preparar mensagem, trava de envio automatico, relogios,
--      privacidade marcada a mao
--   7. permissoes: nada novo executavel por anon/authenticated
--   8. escrita do navegador: so campanha no PC; nada que alimente a fila ou o gateway
--   9. assinatura do gateway nao se repete (gateway_assinaturas_vistas)
-- ============================================================
BEGIN;
SET LOCAL check_function_bodies = off;

-- ------------------------------------------------ 1. bot_conexoes
ALTER TABLE public.bot_conexoes
  ADD COLUMN IF NOT EXISTS modo text NOT NULL DEFAULT 'pc',
  ADD COLUMN IF NOT EXISTS bot_ativo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opcoes jsonb NOT NULL DEFAULT '{"gruposPermitidos": [], "historicoDias": 7}'::jsonb,
  ADD COLUMN IF NOT EXISTS pareamento jsonb,
  ADD COLUMN IF NOT EXISTS grupos_disponiveis jsonb,
  ADD COLUMN IF NOT EXISTS desconectada_em timestamptz;   -- pedido de desconectar de vez

ALTER TABLE public.bot_conexoes DROP CONSTRAINT IF EXISTS bot_conexoes_modo_check;
ALTER TABLE public.bot_conexoes ADD CONSTRAINT bot_conexoes_modo_check CHECK (modo IN ('gateway', 'pc'));
ALTER TABLE public.bot_conexoes DROP CONSTRAINT IF EXISTS bot_conexoes_opcoes_check;
ALTER TABLE public.bot_conexoes ADD CONSTRAINT bot_conexoes_opcoes_check CHECK (jsonb_typeof(opcoes) = 'object');
ALTER TABLE public.bot_conexoes DROP CONSTRAINT IF EXISTS bot_conexoes_status_check;
ALTER TABLE public.bot_conexoes ADD CONSTRAINT bot_conexoes_status_check CHECK (status IN (
  'conectando', 'conectado', 'desconectado', 'deslogado', 'aguardando_qr', 'aguardando_codigo', 'erro'));

-- ------------------------------------------------ 2. bot_conversas
-- Conversa por LID pode nao ter telefone ainda; grupo nunca tem.
ALTER TABLE public.bot_conversas ALTER COLUMN telefone DROP NOT NULL;
ALTER TABLE public.bot_conversas
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS grupo_nome text,
  ADD COLUMN IF NOT EXISTS lid text,
  ADD COLUMN IF NOT EXISTS telefone_confirmado boolean GENERATED ALWAYS AS (telefone IS NOT NULL) STORED,
  ADD COLUMN IF NOT EXISTS privacidade text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS ultima_entrada_em timestamptz,
  -- so saida humana (digitada no celular ou pelo CRM); robo e campanha nao contam
  ADD COLUMN IF NOT EXISTS ultima_saida_em timestamptz;

-- Dados do conector antigo: grupo com os digitos do jid no telefone e LID
-- gravado como telefone.
-- jid repetido na mesma conexao: o mais antigo fica com ele (o jid e so endereco).
-- Vem antes do resto para nenhuma linha ficar sem telefone e sem jid.
UPDATE public.bot_conversas c SET jid = NULL
 WHERE c.jid IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.bot_conversas o
    WHERE o.conexao_id = c.conexao_id AND o.jid = c.jid AND (o.created_at, o.id) < (c.created_at, c.id));
UPDATE public.bot_conversas SET tipo = 'grupo' WHERE jid LIKE '%@g.us' AND tipo <> 'grupo';
UPDATE public.bot_conversas SET telefone = NULL WHERE tipo = 'grupo' AND telefone IS NOT NULL;
UPDATE public.bot_conversas SET estado = 'humano' WHERE tipo = 'grupo' AND estado = 'bot';
UPDATE public.bot_conversas c
   SET lid = c.jid,
       telefone = CASE WHEN c.telefone = split_part(c.jid, '@', 1) THEN NULL ELSE c.telefone END
 WHERE c.jid LIKE '%@lid' AND c.lid IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.bot_conversas o WHERE o.conexao_id = c.conexao_id AND o.lid = c.jid);

ALTER TABLE public.bot_conversas DROP CONSTRAINT IF EXISTS bot_conversas_tipo_check;
ALTER TABLE public.bot_conversas ADD CONSTRAINT bot_conversas_tipo_check CHECK (tipo IN ('individual', 'grupo'));
ALTER TABLE public.bot_conversas DROP CONSTRAINT IF EXISTS bot_conversas_privacidade_check;
ALTER TABLE public.bot_conversas ADD CONSTRAINT bot_conversas_privacidade_check
  CHECK (privacidade IN ('normal', 'so_metadados', 'ignorar'));
ALTER TABLE public.bot_conversas DROP CONSTRAINT IF EXISTS bot_conversas_identificada;
ALTER TABLE public.bot_conversas ADD CONSTRAINT bot_conversas_identificada
  CHECK (telefone IS NOT NULL OR jid IS NOT NULL OR lid IS NOT NULL);
-- Robo nunca atende grupo (trava no banco, alem da rota e do motor).
ALTER TABLE public.bot_conversas DROP CONSTRAINT IF EXISTS bot_conversas_grupo_sem_robo;
ALTER TABLE public.bot_conversas ADD CONSTRAINT bot_conversas_grupo_sem_robo
  CHECK (tipo <> 'grupo' OR (estado <> 'bot' AND telefone IS NULL));

DROP INDEX IF EXISTS public.bot_conversas_jid;
CREATE UNIQUE INDEX IF NOT EXISTS bot_conversas_jid_unico ON public.bot_conversas (conexao_id, jid) WHERE jid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bot_conversas_lid_unico ON public.bot_conversas (conexao_id, lid) WHERE lid IS NOT NULL;

-- ------------------------------------------------ 3. bot_mensagens
ALTER TABLE public.bot_mensagens
  ADD COLUMN IF NOT EXISTS wa_em timestamptz,               -- hora do WhatsApp
  ADD COLUMN IF NOT EXISTS autor text,
  ADD COLUMN IF NOT EXISTS participante_jid text,
  ADD COLUMN IF NOT EXISTS participante_telefone text,
  ADD COLUMN IF NOT EXISTS participante_nome text,
  ADD COLUMN IF NOT EXISTS midia jsonb,
  ADD COLUMN IF NOT EXISTS anuncio jsonb,                   -- bruto (C3): quem decide a origem e a fase de dados
  ADD COLUMN IF NOT EXISTS origem_evento text NOT NULL DEFAULT 'tempo_real',
  ADD COLUMN IF NOT EXISTS citado_wa_id text,
  ADD COLUMN IF NOT EXISTS wa_entregue_em timestamptz,      -- entregue_em continua = "entregue ao conector"
  ADD COLUMN IF NOT EXISTS wa_lida_em timestamptz,          -- saida: cliente viu | entrada: mentorado viu
  ADD COLUMN IF NOT EXISTS editada_em timestamptz,
  ADD COLUMN IF NOT EXISTS apagada_em timestamptz,          -- so informa: o corpo fica (C16)
  ADD COLUMN IF NOT EXISTS reservada_ate timestamptz;       -- reserva da fila
ALTER TABLE public.bot_mensagens ADD COLUMN IF NOT EXISTS momento timestamptz
  GENERATED ALWAYS AS (COALESCE(wa_em, created_at)) STORED;  -- o "quando" do arquivo e dos relatorios

UPDATE public.bot_mensagens SET autor = CASE
    WHEN direcao = 'entrada' THEN 'cliente'
    WHEN disparo_id IS NOT NULL THEN 'campanha'
    WHEN enviada_por IS NOT NULL THEN 'crm'
    ELSE 'bot' END
 WHERE autor IS NULL;
UPDATE public.bot_mensagens SET origem_evento = 'fila'
 WHERE direcao = 'saida' AND autor IN ('bot', 'crm', 'campanha') AND origem_evento <> 'fila';
UPDATE public.bot_mensagens SET status = 'erro', erro = COALESCE(erro, 'status antigo invalido')
 WHERE direcao = 'saida' AND status NOT IN ('pendente', 'enviada', 'erro');
ALTER TABLE public.bot_mensagens ALTER COLUMN autor SET NOT NULL;

ALTER TABLE public.bot_mensagens DROP CONSTRAINT IF EXISTS bot_mensagens_tipo_check;
ALTER TABLE public.bot_mensagens ADD CONSTRAINT bot_mensagens_tipo_check CHECK (tipo IN (
  'texto', 'imagem', 'audio', 'video', 'documento', 'figurinha', 'localizacao', 'contato',
  'reacao', 'enquete', 'outro', 'sistema'));
ALTER TABLE public.bot_mensagens DROP CONSTRAINT IF EXISTS bot_mensagens_autor_check;
ALTER TABLE public.bot_mensagens ADD CONSTRAINT bot_mensagens_autor_check CHECK (
  (direcao = 'entrada' AND autor IN ('cliente', 'sistema'))
  OR (direcao = 'saida' AND autor IN ('humano', 'crm', 'bot', 'campanha', 'sistema')));
ALTER TABLE public.bot_mensagens DROP CONSTRAINT IF EXISTS bot_mensagens_origem_evento_check;
ALTER TABLE public.bot_mensagens ADD CONSTRAINT bot_mensagens_origem_evento_check
  CHECK (origem_evento IN ('tempo_real', 'offline', 'historico', 'fila'));
-- Entrada so 'recebida'; saida pendente so da fila; o que o mentorado digitou ja saiu.
ALTER TABLE public.bot_mensagens DROP CONSTRAINT IF EXISTS bot_mensagens_status_coerente;
ALTER TABLE public.bot_mensagens ADD CONSTRAINT bot_mensagens_status_coerente CHECK (
  (direcao = 'entrada' AND status = 'recebida')
  OR (direcao = 'saida' AND status IN ('pendente', 'enviada', 'erro')
      AND (status <> 'pendente' OR origem_evento = 'fila')
      AND (autor <> 'humano' OR status = 'enviada')));
ALTER TABLE public.bot_mensagens DROP CONSTRAINT IF EXISTS bot_mensagens_tentativas_check;
ALTER TABLE public.bot_mensagens ADD CONSTRAINT bot_mensagens_tentativas_check CHECK (tentativas >= 0);

CREATE INDEX IF NOT EXISTS idx_bot_mensagens_momento ON public.bot_mensagens (conversa_id, momento);
-- recibo, edicao, apagada, eco e repetida acham a mensagem pelo wa_id dentro da conexao
CREATE INDEX IF NOT EXISTS idx_bot_mensagens_wa_id_busca ON public.bot_mensagens (wa_id) WHERE wa_id IS NOT NULL;

-- ------------------------------------------------ 4. wa_contatos_base (V11)
-- Conversas 1:1 que o historico do pareamento trouxe, sem corpo: cliente
-- antigo que volta meses depois nao conta como conversa nova.
CREATE TABLE IF NOT EXISTS public.wa_contatos_base (
  conexao_id uuid NOT NULL REFERENCES public.bot_conexoes(id) ON DELETE CASCADE,
  jid text NOT NULL,
  telefone text,
  lid text,
  nome text,
  ultimo_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conexao_id, jid)
);
CREATE INDEX IF NOT EXISTS idx_wa_contatos_base_telefone ON public.wa_contatos_base (conexao_id, telefone) WHERE telefone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_contatos_base_lid ON public.wa_contatos_base (conexao_id, lid) WHERE lid IS NOT NULL;
ALTER TABLE public.wa_contatos_base ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Ver base de contatos da conexao" ON public.wa_contatos_base;
CREATE POLICY "Ver base de contatos da conexao" ON public.wa_contatos_base
  FOR SELECT TO authenticated USING (public.bot_acesso_conexao(conexao_id));

-- ------------------------------------------------ 5. funcoes
-- Data ISO do evento; texto como 'now' ou 'today' nao passa. Futuro e cortado.
CREATE OR REPLACE FUNCTION public.bot_ts(_v text)
 RETURNS timestamptz
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE v timestamptz;
BEGIN
  IF _v IS NULL OR _v !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)$' THEN
    RETURN NULL;
  END IF;
  v := _v::timestamptz;
  IF v < '2009-01-01'::timestamptz THEN RETURN NULL; END IF;
  RETURN LEAST(v, now() + interval '5 minutes');
EXCEPTION WHEN others THEN
  RETURN NULL;
END; $function$;

-- O mesmo id que o gateway usa no envio (gateway/mapear.mjs, waIdDaFila):
-- '3EB0' + 18 hex maiusculos do SHA-256 de 'fila:<id>'. Gravado ja ao
-- enfileirar, o eco do envio colide com ele e nunca vira mensagem 'humano'.
CREATE OR REPLACE FUNCTION public.bot_wa_id_da_fila(_id uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT '3EB0' || upper(left(encode(sha256(convert_to('fila:' || _id::text, 'UTF8')), 'hex'), 18))
$function$;

-- Gatilho: autor, origem 'fila' e wa_id de quem entra na fila de saida.
CREATE OR REPLACE FUNCTION public.bot_preparar_mensagem()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.autor IS NULL THEN
    NEW.autor := CASE
      WHEN NEW.direcao = 'entrada' THEN 'cliente'
      WHEN NEW.disparo_id IS NOT NULL THEN 'campanha'
      WHEN NEW.enviada_por IS NOT NULL THEN 'crm'
      ELSE 'bot' END;
  END IF;
  IF NEW.direcao = 'saida' AND NEW.status = 'pendente' THEN
    NEW.origem_evento := 'fila';
    IF NEW.wa_id IS NULL THEN NEW.wa_id := public.bot_wa_id_da_fila(NEW.id); END IF;
  END IF;
  RETURN NEW;
END; $function$;

-- Trava no banco: nada da fila nem automatico (robo, campanha) para grupo,
-- e nada automatico para conversa marcada como ignorar. O que ja saiu (ou deu
-- erro) nao vai sair de novo: mudar de conversa na fusao nao passa por aqui.
CREATE OR REPLACE FUNCTION public.bot_trava_envio_automatico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tipo text; v_priv text;
BEGIN
  IF NEW.direcao <> 'saida' OR (NEW.autor NOT IN ('bot', 'campanha') AND NEW.origem_evento <> 'fila') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status <> 'pendente' THEN RETURN NEW; END IF;
  SELECT tipo, privacidade INTO v_tipo, v_priv FROM public.bot_conversas WHERE id = NEW.conversa_id;
  IF v_tipo = 'grupo' THEN
    RAISE EXCEPTION 'envio automatico ou pela fila bloqueado em conversa de grupo' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.autor IN ('bot', 'campanha') AND v_priv = 'ignorar' THEN
    RAISE EXCEPTION 'envio automatico bloqueado em conversa ignorada' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $function$;

-- Relogios da conversa pela hora do WhatsApp. Pendente e erro nao contam
-- (nao sairam); ultima_saida_em so com autor humano ou crm.
CREATE OR REPLACE FUNCTION public.bot_marcar_ultima_mensagem()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t timestamptz := COALESCE(NEW.wa_em, NEW.created_at);
BEGIN
  IF NEW.status IN ('pendente', 'erro') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status AND OLD.wa_em IS NOT DISTINCT FROM NEW.wa_em THEN RETURN NEW; END IF;
  UPDATE public.bot_conversas SET
    ultima_mensagem_em = GREATEST(COALESCE(ultima_mensagem_em, t), t),
    ultima_entrada_em = CASE WHEN NEW.direcao = 'entrada' THEN GREATEST(COALESCE(ultima_entrada_em, t), t) ELSE ultima_entrada_em END,
    ultima_saida_em = CASE WHEN NEW.direcao = 'saida' AND NEW.autor IN ('humano', 'crm')
                           THEN GREATEST(COALESCE(ultima_saida_em, t), t) ELSE ultima_saida_em END
  WHERE id = NEW.conversa_id;
  RETURN NEW;
END; $function$;

-- Apaga o texto ja gravado de uma conversa (C16): corpo e nome de arquivo das
-- mensagens e a copia que foi para a linha do tempo do cartao ("Cliente: ...").
CREATE OR REPLACE FUNCTION public.bot_apagar_texto_da_conversa(_conversa_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cartao uuid;
BEGIN
  UPDATE public.bot_mensagens
     SET corpo = NULL, midia = NULLIF(midia - 'nomeArquivo', '{}'::jsonb)
   WHERE conversa_id = _conversa_id AND (corpo IS NOT NULL OR midia ? 'nomeArquivo');
  SELECT cartao_id INTO v_cartao FROM public.bot_conversas WHERE id = _conversa_id;
  IF v_cartao IS NOT NULL THEN
    UPDATE public.crm_atividades
       SET corpo = regexp_replace(corpo, '^(Você \(CRM\)|Você|Robô|Campanha|Cliente): .*$', '\1: [mensagem não registrada]')
     WHERE cartao_id = v_cartao AND tipo = 'whatsapp'
       AND corpo ~ '^(Você \(CRM\)|Você|Robô|Campanha|Cliente): '
       AND corpo !~ ': \[mensagem não registrada\]$';
  END IF;
END; $function$;

-- Marcacao manual de privacidade (C16): o texto do que ja estava gravado sai
-- na hora, por qualquer caminho que mude a coluna (servidor ou navegador).
CREATE OR REPLACE FUNCTION public.bot_conversas_privacidade()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.privacidade <> 'normal' AND NEW.privacidade IS DISTINCT FROM OLD.privacidade THEN
    PERFORM public.bot_apagar_texto_da_conversa(NEW.id);
  END IF;
  RETURN NEW;
END; $function$;

-- Linha do tempo do cartao com o autor certo (antes toda saida virava "Robo:").
-- Conversa marcada a mao: 'ignorar' nao registra; 'so_metadados' registra sem o texto.
DROP FUNCTION IF EXISTS public.bot_registrar_no_cartao(uuid, text, text);
CREATE OR REPLACE FUNCTION public.bot_registrar_no_cartao(_conversa_id uuid, _texto text, _direcao text, _autor text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cartao uuid; v_priv text;
BEGIN
  SELECT cartao_id, privacidade INTO v_cartao, v_priv FROM public.bot_conversas WHERE id = _conversa_id;
  IF v_cartao IS NULL OR v_priv = 'ignorar' THEN RETURN; END IF;
  INSERT INTO public.crm_atividades (cartao_id, tipo, corpo)
  VALUES (v_cartao, 'whatsapp',
    CASE COALESCE(_autor, CASE WHEN _direcao = 'saida' THEN 'bot' ELSE 'cliente' END)
      WHEN 'humano' THEN 'Você: '
      WHEN 'crm' THEN 'Você (CRM): '
      WHEN 'bot' THEN 'Robô: '
      WHEN 'campanha' THEN 'Campanha: '
      ELSE 'Cliente: ' END
    || CASE WHEN v_priv = 'normal' THEN left(COALESCE(_texto, ''), 500) ELSE '[mensagem não registrada]' END);
END; $function$;

-- Cartao no funil para conversa individual; aceita conversa por LID (sem telefone).
CREATE OR REPLACE FUNCTION public.bot_vincular_cartao(_conversa_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conv public.bot_conversas%ROWTYPE;
  v_escopo text; v_owner uuid;
  v_quadro uuid; v_coluna uuid; v_cartao uuid; v_pos double precision;
BEGIN
  SELECT * INTO v_conv FROM public.bot_conversas WHERE id = _conversa_id;
  IF NOT FOUND OR v_conv.tipo = 'grupo' THEN RETURN NULL; END IF;
  IF v_conv.cartao_id IS NOT NULL THEN RETURN v_conv.cartao_id; END IF;

  SELECT escopo, owner_id INTO v_escopo, v_owner FROM public.bot_conexoes WHERE id = v_conv.conexao_id;
  IF v_owner IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_quadro FROM public.crm_quadros
  WHERE escopo = v_escopo AND owner_id = v_owner AND tipo = 'funil' AND arquivado_em IS NULL
  ORDER BY created_at LIMIT 1;
  IF v_quadro IS NULL THEN RETURN NULL; END IF;

  IF v_conv.telefone IS NOT NULL THEN
    SELECT id INTO v_cartao FROM public.crm_cartoes
    WHERE quadro_id = v_quadro AND contato_telefone = v_conv.telefone AND arquivado_em IS NULL LIMIT 1;
  END IF;

  IF v_cartao IS NULL THEN
    SELECT id INTO v_coluna FROM public.crm_colunas WHERE quadro_id = v_quadro ORDER BY posicao LIMIT 1;
    IF v_coluna IS NULL THEN RETURN NULL; END IF;
    SELECT COALESCE(MAX(posicao), 0) + 1000 INTO v_pos FROM public.crm_cartoes WHERE coluna_id = v_coluna;
    INSERT INTO public.crm_cartoes (quadro_id, coluna_id, posicao, titulo, contato_nome, contato_telefone, origem)
    VALUES (v_quadro, v_coluna, v_pos,
            COALESCE(NULLIF(btrim(COALESCE(v_conv.nome, '')), ''), v_conv.telefone, 'Contato do WhatsApp'),
            v_conv.nome, v_conv.telefone, 'whatsapp')
    RETURNING id INTO v_cartao;
    INSERT INTO public.crm_atividades (cartao_id, tipo, corpo)
    VALUES (v_cartao, 'whatsapp', 'Entrou pelo WhatsApp');
  END IF;

  UPDATE public.bot_conversas SET cartao_id = v_cartao WHERE id = _conversa_id;
  RETURN v_cartao;
END; $function$;

-- Mesma pessoa em duas conversas (LID e telefone): a principal absorve a outra.
CREATE OR REPLACE FUNCTION public.bot_fundir_conversas(_principal uuid, _outra uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE p public.bot_conversas%ROWTYPE; o public.bot_conversas%ROWTYPE; v_priv text;
BEGIN
  IF _principal IS NULL OR _outra IS NULL OR _principal = _outra THEN RETURN; END IF;
  SELECT * INTO p FROM public.bot_conversas WHERE id = _principal FOR UPDATE;
  SELECT * INTO o FROM public.bot_conversas WHERE id = _outra FOR UPDATE;
  IF p.id IS NULL OR o.id IS NULL OR p.conexao_id <> o.conexao_id OR p.tipo <> 'individual' OR o.tipo <> 'individual' THEN
    RETURN;
  END IF;

  -- A marcacao manual de uma das duas vale para a pessoa (C16): o texto das
  -- duas sai antes de juntar, e nada automatico fica na fila de quem e 'ignorar'.
  v_priv := CASE
    WHEN 'ignorar' IN (p.privacidade, o.privacidade) THEN 'ignorar'
    WHEN 'so_metadados' IN (p.privacidade, o.privacidade) THEN 'so_metadados'
    ELSE 'normal' END;
  IF v_priv = 'ignorar' THEN
    UPDATE public.bot_mensagens SET status = 'erro', erro = 'conversa_ignorada', reservada_ate = NULL
     WHERE conversa_id IN (_principal, _outra) AND direcao = 'saida' AND status = 'pendente' AND autor IN ('bot', 'campanha');
  END IF;
  IF v_priv <> 'normal' THEN
    PERFORM public.bot_apagar_texto_da_conversa(_outra);
    PERFORM public.bot_apagar_texto_da_conversa(_principal);
  END IF;

  UPDATE public.bot_mensagens m SET conversa_id = _principal
   WHERE m.conversa_id = _outra
     AND (m.wa_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.bot_mensagens x WHERE x.conversa_id = _principal AND x.wa_id = m.wa_id));
  UPDATE public.bot_verificacoes SET conversa_id = _principal WHERE conversa_id = _outra;
  -- o que sobrou sao repetidas; somem com a conversa (ON DELETE CASCADE)
  DELETE FROM public.bot_conversas WHERE id = _outra;

  -- O robo no meio do fluxo na outra conversa continua de onde parou.
  UPDATE public.bot_conversas SET
    telefone = COALESCE(telefone, o.telefone),
    jid = COALESCE(jid, o.jid),
    lid = COALESCE(lid, o.lid),
    nome = COALESCE(nome, o.nome),
    cartao_id = COALESCE(cartao_id, o.cartao_id),
    estado = CASE WHEN estado = 'bot' AND o.estado <> 'bot' THEN o.estado ELSE estado END,
    fluxo_id = CASE WHEN fluxo_id IS NULL THEN o.fluxo_id ELSE fluxo_id END,
    passo_atual_id = CASE WHEN fluxo_id IS NULL THEN o.passo_atual_id ELSE passo_atual_id END,
    tentativas_passo = CASE WHEN fluxo_id IS NULL THEN o.tentativas_passo ELSE tentativas_passo END,
    privacidade = v_priv,
    ultima_mensagem_em = GREATEST(ultima_mensagem_em, o.ultima_mensagem_em),
    ultima_entrada_em = GREATEST(ultima_entrada_em, o.ultima_entrada_em),
    ultima_saida_em = GREATEST(ultima_saida_em, o.ultima_saida_em),
    created_at = LEAST(created_at, o.created_at)
  WHERE id = _principal
  RETURNING * INTO p;

  IF p.cartao_id IS NOT NULL AND p.telefone IS NOT NULL THEN
    UPDATE public.crm_cartoes SET contato_telefone = p.telefone WHERE id = p.cartao_id AND contato_telefone IS NULL;
  END IF;
END; $function$;

-- Evento 'mensagem' (gateway/CONTRATO.md 3.1). Devolve se o robo pode responder.
CREATE OR REPLACE FUNCTION public.bot_evento_mensagem(_conexao_id uuid, _bot_ativo boolean, _grupos jsonb, _ev jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_waid text := left(NULLIF(btrim(_ev->>'waId'), ''), 120);
  v_chat text := lower(btrim(COALESCE(_ev->>'chatJid', '')));
  v_demim boolean := COALESCE(_ev->'deMim' = 'true'::jsonb, false);
  -- origem desconhecida conta como offline: nunca aciona o robo
  v_origem text := CASE WHEN _ev->>'origemEvento' IN ('tempo_real', 'offline', 'historico') THEN _ev->>'origemEvento' ELSE 'offline' END;
  v_em timestamptz := COALESCE(public.bot_ts(_ev->>'waEm'), now());
  v_tipo text := CASE WHEN _ev->>'tipoMidia' IN ('texto', 'imagem', 'audio', 'video', 'documento', 'figurinha',
                   'localizacao', 'contato', 'reacao', 'enquete', 'outro') THEN _ev->>'tipoMidia' ELSE 'outro' END;
  v_corpo text := left(NULLIF(_ev->>'corpo', ''), 10000);
  v_nome text;
  v_grupo boolean;
  v_midia jsonb; v_anuncio jsonb;
  v_tel text; v_lid text;
  v_por_tel uuid; v_por_lid uuid; v_por_jid uuid; v_conv_id uuid; v_outra uuid;
  v_conv public.bot_conversas%ROWTYPE;
  v_exist record;
  v_novo_tel text; v_novo_lid text; v_novo_jid text; v_novo_nome text;
  v_msg uuid; v_cartao uuid; v_responder boolean;
BEGIN
  IF v_waid IS NULL THEN RAISE EXCEPTION 'waId ausente'; END IF;
  IF v_chat !~ '^[0-9]+(-[0-9]+)?@(s\.whatsapp\.net|lid|g\.us)$' THEN RAISE EXCEPTION 'chatJid invalido'; END IF;
  v_grupo := v_chat LIKE '%@g.us';
  IF v_grupo AND NOT COALESCE(_grupos ? v_chat, false) THEN
    RETURN jsonb_build_object('ignorada', 'grupo_nao_permitido');
  END IF;

  IF jsonb_typeof(_ev->'midia') = 'object' THEN
    v_midia := jsonb_strip_nulls(jsonb_build_object(
      'mimetype', left(_ev->'midia'->>'mimetype', 120),
      'duracaoSeg', CASE WHEN jsonb_typeof(_ev->'midia'->'duracaoSeg') = 'number' THEN _ev->'midia'->'duracaoSeg' END,
      'ptt', CASE WHEN jsonb_typeof(_ev->'midia'->'ptt') = 'boolean' THEN _ev->'midia'->'ptt' END,
      'nomeArquivo', left(_ev->'midia'->>'nomeArquivo', 255),
      'tamanho', CASE WHEN jsonb_typeof(_ev->'midia'->'tamanho') = 'number' THEN _ev->'midia'->'tamanho' END,
      'visualizacaoUnica', CASE WHEN _ev->'midia'->'visualizacaoUnica' = 'true'::jsonb THEN true END));
    IF v_midia = '{}'::jsonb THEN v_midia := NULL; END IF;
  END IF;
  IF NOT v_demim AND NOT v_grupo AND jsonb_typeof(_ev->'anuncio') = 'object' THEN
    SELECT jsonb_object_agg(e.k, left(e.v, 1000)) INTO v_anuncio
      FROM jsonb_each_text(_ev->'anuncio') AS e(k, v)
     WHERE e.k IN ('sourceType', 'sourceId', 'sourceUrl', 'ctwaClid', 'titulo', 'corpo',
                   'conversionSource', 'entryPointConversionSource', 'entryPointConversionApp')
       AND COALESCE(e.v, '') <> '';
  END IF;

  -- Ja gravada (entrega "pelo menos uma vez"), mesmo que noutra conversa da
  -- conexao (LID x telefone ainda nao fundidos).
  SELECT m.id, m.origem_evento, m.status INTO v_exist
    FROM public.bot_mensagens m JOIN public.bot_conversas c ON c.id = m.conversa_id
   WHERE c.conexao_id = _conexao_id AND m.wa_id = v_waid
   ORDER BY (m.origem_evento = 'fila') DESC
   LIMIT 1;
  IF FOUND THEN
    IF v_exist.origem_evento = 'fila' THEN
      -- Eco do que a propria fila mandou: so confirma o envio, nao vira 'humano'.
      IF v_demim THEN
        UPDATE public.bot_mensagens SET status = 'enviada', enviada_em = COALESCE(enviada_em, v_em),
               wa_em = COALESCE(wa_em, v_em), erro = NULL, reservada_ate = NULL
         WHERE id = v_exist.id AND status <> 'enviada';
      END IF;
      RETURN jsonb_build_object('mensagemId', v_exist.id, 'eco', true);
    END IF;
    -- Visualizacao unica que chegou vazia e agora veio com conteudo: completa.
    UPDATE public.bot_mensagens m SET
      tipo = v_tipo,
      corpo = CASE WHEN c.privacidade = 'normal' THEN v_corpo END,
      midia = CASE WHEN c.privacidade = 'normal' THEN v_midia ELSE NULLIF(v_midia - 'nomeArquivo', '{}'::jsonb) END
      FROM public.bot_conversas c
     WHERE m.id = v_exist.id AND c.id = m.conversa_id
       AND m.corpo IS NULL AND (m.midia IS NULL OR m.midia - 'visualizacaoUnica' = '{}'::jsonb)
       AND (v_corpo IS NOT NULL OR (v_midia IS NOT NULL AND v_midia - 'visualizacaoUnica' <> '{}'::jsonb));
    RETURN jsonb_build_object('mensagemId', v_exist.id, 'repetida', true);
  END IF;

  IF v_grupo THEN
    SELECT * INTO v_conv FROM public.bot_conversas WHERE conexao_id = _conexao_id AND jid = v_chat;
    IF NOT FOUND THEN
      INSERT INTO public.bot_conversas (conexao_id, telefone, jid, tipo, grupo_nome, estado)
      VALUES (_conexao_id, NULL, v_chat, 'grupo', left(NULLIF(btrim(_ev->>'grupoNome'), ''), 200), 'humano')
      RETURNING * INTO v_conv;
    ELSIF v_conv.privacidade <> 'ignorar' AND NULLIF(btrim(_ev->>'grupoNome'), '') IS NOT NULL
          AND v_conv.grupo_nome IS DISTINCT FROM left(btrim(_ev->>'grupoNome'), 200) THEN
      UPDATE public.bot_conversas SET grupo_nome = left(btrim(_ev->>'grupoNome'), 200) WHERE id = v_conv.id
      RETURNING * INTO v_conv;
    END IF;
  ELSE
    -- O jid de telefone manda; LID nunca vira telefone (contrato 3.1).
    IF v_chat LIKE '%@s.whatsapp.net' THEN
      v_tel := split_part(v_chat, '@', 1);
    ELSE
      v_tel := NULLIF(regexp_replace(COALESCE(_ev->>'telefone', ''), '\D', '', 'g'), '');
    END IF;
    IF v_tel IS NOT NULL AND length(v_tel) NOT BETWEEN 8 AND 15 THEN v_tel := NULL; END IF;
    v_lid := CASE WHEN v_chat LIKE '%@lid' THEN v_chat ELSE lower(NULLIF(btrim(_ev->>'lid'), '')) END;
    IF v_lid IS NOT NULL AND v_lid !~ '^[0-9]+@lid$' THEN v_lid := NULL; END IF;
    IF NOT v_demim THEN v_nome := left(NULLIF(btrim(_ev->>'nome'), ''), 120); END IF;

    IF v_tel IS NOT NULL THEN
      SELECT id INTO v_por_tel FROM public.bot_conversas WHERE conexao_id = _conexao_id AND telefone = v_tel;
    END IF;
    SELECT id INTO v_por_jid FROM public.bot_conversas
     WHERE conexao_id = _conexao_id AND jid = v_chat AND tipo = 'individual';
    IF v_lid IS NOT NULL THEN
      SELECT id INTO v_por_lid FROM public.bot_conversas
       WHERE conexao_id = _conexao_id AND lid = v_lid AND tipo = 'individual';
    END IF;
    v_conv_id := COALESCE(v_por_tel, v_por_jid, v_por_lid);

    IF v_conv_id IS NOT NULL THEN
      -- Mesma pessoa em duas conversas: junta, a nao ser que a outra ja tenha
      -- OUTRO telefone (dado em conflito fica separado).
      FOREACH v_outra IN ARRAY ARRAY[v_por_jid, v_por_lid] LOOP
        IF v_outra IS NOT NULL AND v_outra <> v_conv_id AND EXISTS (
             SELECT 1 FROM public.bot_conversas o WHERE o.id = v_outra AND (o.telefone IS NULL OR o.telefone = v_tel)) THEN
          PERFORM public.bot_fundir_conversas(v_conv_id, v_outra);
        END IF;
      END LOOP;
      SELECT * INTO v_conv FROM public.bot_conversas WHERE id = v_conv_id;
      IF v_conv.privacidade = 'ignorar' THEN
        RETURN jsonb_build_object('conversaId', v_conv.id, 'ignorada', 'privacidade');
      END IF;

      v_novo_tel := COALESCE(v_conv.telefone, v_tel);
      v_novo_lid := v_conv.lid;
      IF v_novo_lid IS NULL AND v_lid IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM public.bot_conversas o WHERE o.conexao_id = _conexao_id AND o.lid = v_lid) THEN
        v_novo_lid := v_lid;
      END IF;
      v_novo_jid := v_conv.jid;
      IF v_novo_jid IS NULL AND NOT EXISTS (
           SELECT 1 FROM public.bot_conversas o WHERE o.conexao_id = _conexao_id AND o.jid = v_chat) THEN
        v_novo_jid := v_chat;
      END IF;
      v_novo_nome := COALESCE(v_nome, v_conv.nome);
      IF (v_novo_tel, v_novo_lid, v_novo_jid, v_novo_nome) IS DISTINCT FROM (v_conv.telefone, v_conv.lid, v_conv.jid, v_conv.nome) THEN
        UPDATE public.bot_conversas SET telefone = v_novo_tel, lid = v_novo_lid, jid = v_novo_jid, nome = v_novo_nome
         WHERE id = v_conv.id
        RETURNING * INTO v_conv;
      END IF;
      IF v_conv.cartao_id IS NOT NULL AND v_conv.telefone IS NOT NULL THEN
        UPDATE public.crm_cartoes SET contato_telefone = v_conv.telefone WHERE id = v_conv.cartao_id AND contato_telefone IS NULL;
      END IF;
    ELSE
      INSERT INTO public.bot_conversas (conexao_id, telefone, jid, lid, nome, tipo, estado)
      VALUES (_conexao_id, v_tel, v_chat, v_lid, v_nome, 'individual',
              -- so nasce com o robo quem chegou ao vivo num numero com o robo ligado
              CASE WHEN NOT v_demim AND v_origem = 'tempo_real' AND COALESCE(_bot_ativo, false) THEN 'bot' ELSE 'humano' END)
      RETURNING * INTO v_conv;
    END IF;
  END IF;

  IF v_conv.privacidade = 'ignorar' THEN
    RETURN jsonb_build_object('conversaId', v_conv.id, 'ignorada', 'privacidade');
  END IF;
  IF v_conv.privacidade = 'so_metadados' THEN
    v_corpo := NULL;
    v_midia := NULLIF(v_midia - 'nomeArquivo', '{}'::jsonb);
  END IF;

  INSERT INTO public.bot_mensagens (conversa_id, direcao, status, autor, tipo, corpo, wa_id, wa_em, enviada_em,
                                    participante_jid, participante_telefone, participante_nome,
                                    midia, citado_wa_id, anuncio, origem_evento)
  VALUES (v_conv.id,
          CASE WHEN v_demim THEN 'saida' ELSE 'entrada' END,
          CASE WHEN v_demim THEN 'enviada' ELSE 'recebida' END,
          CASE WHEN v_demim THEN 'humano' ELSE 'cliente' END,
          v_tipo, v_corpo, v_waid, v_em, CASE WHEN v_demim THEN v_em END,
          CASE WHEN v_grupo AND NOT v_demim THEN left(NULLIF(btrim(_ev->>'participanteJid'), ''), 120) END,
          CASE WHEN v_grupo AND NOT v_demim THEN NULLIF(left(regexp_replace(COALESCE(_ev->>'participanteTelefone', ''), '\D', '', 'g'), 15), '') END,
          CASE WHEN v_grupo AND NOT v_demim THEN left(NULLIF(btrim(_ev->>'participanteNome'), ''), 120) END,
          v_midia, left(NULLIF(btrim(_ev->>'citadoWaId'), ''), 120), v_anuncio, v_origem)
  ON CONFLICT (conversa_id, wa_id) WHERE wa_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_msg;
  IF v_msg IS NULL THEN
    RETURN jsonb_build_object('conversaId', v_conv.id, 'repetida', true);
  END IF;

  IF v_demim AND v_origem <> 'historico' AND v_conv.estado = 'bot' THEN
    UPDATE public.bot_conversas SET estado = 'humano' WHERE id = v_conv.id;   -- o mentorado assumiu
  END IF;

  -- Historico nao cria cartao nem linha do tempo.
  IF NOT v_grupo AND v_origem <> 'historico' AND v_conv.privacidade = 'normal' THEN
    v_cartao := v_conv.cartao_id;
    IF v_cartao IS NULL AND NOT v_demim THEN v_cartao := public.bot_vincular_cartao(v_conv.id); END IF;
    IF v_cartao IS NOT NULL THEN
      PERFORM public.bot_registrar_no_cartao(v_conv.id, COALESCE(v_corpo, '[' || v_tipo || ']'),
        CASE WHEN v_demim THEN 'saida' ELSE 'entrada' END, CASE WHEN v_demim THEN 'humano' ELSE 'cliente' END);
    END IF;
  END IF;

  -- Trava 1 do robo: so tempo real, individual, do cliente, com texto (reacao,
  -- figurinha e enquete nao sao resposta), robo ligado, conversa com o robo,
  -- privacidade normal e sem resposta humana recente.
  v_responder := NOT v_demim AND NOT v_grupo AND v_origem = 'tempo_real' AND COALESCE(_bot_ativo, false)
    AND v_tipo NOT IN ('reacao', 'figurinha', 'enquete') AND COALESCE(btrim(v_corpo), '') <> ''
    AND v_conv.estado = 'bot' AND v_conv.privacidade = 'normal'
    AND v_em > now() - interval '5 minutes'
    AND (v_conv.ultima_saida_em IS NULL OR v_conv.ultima_saida_em < now() - interval '30 minutes');

  RETURN jsonb_build_object('conversaId', v_conv.id, 'mensagemId', v_msg, 'responder', v_responder,
                            'texto', COALESCE(v_corpo, ''), 'nome', v_conv.nome, 'telefone', v_conv.telefone);
END; $function$;

-- Eventos 'recibo', 'edicao' e 'apagada'. waId desconhecido nao e erro (contrato 2).
-- A mensagem e achada pelo waId dentro da conexao: o recibo pode vir com o jid na outra forma.
CREATE OR REPLACE FUNCTION public.bot_evento_marcar(_conexao_id uuid, _ev jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tipo text := _ev->>'tipo';
  v_waid text := left(NULLIF(btrim(_ev->>'waId'), ''), 120);
  v_status text := _ev->>'status';
  v_em timestamptz;
  v_chat text; v_direcao text; v_participante text;
BEGIN
  IF v_waid IS NULL THEN RAISE EXCEPTION 'waId ausente'; END IF;

  IF v_tipo = 'recibo' THEN
    IF v_status IS NULL OR v_status NOT IN ('entregue', 'lida', 'reproduzida') THEN
      RAISE EXCEPTION 'status de recibo invalido';
    END IF;
    v_em := COALESCE(public.bot_ts(_ev->>'em'), now());
    UPDATE public.bot_mensagens m SET
      wa_entregue_em = CASE WHEN m.direcao = 'saida' THEN COALESCE(m.wa_entregue_em, v_em) ELSE m.wa_entregue_em END,
      wa_lida_em = CASE WHEN v_status IN ('lida', 'reproduzida') THEN COALESCE(m.wa_lida_em, v_em) ELSE m.wa_lida_em END,
      -- recibo de mensagem da fila sem confirmacao (ou dada como erro): ela saiu
      status = CASE WHEN m.status IN ('pendente', 'erro') THEN 'enviada' ELSE m.status END,
      erro = CASE WHEN m.status IN ('pendente', 'erro') THEN NULL ELSE m.erro END,
      enviada_em = CASE WHEN m.status IN ('pendente', 'erro') THEN COALESCE(m.enviada_em, v_em) ELSE m.enviada_em END,
      wa_em = CASE WHEN m.status IN ('pendente', 'erro') THEN COALESCE(m.wa_em, v_em) ELSE m.wa_em END,
      reservada_ate = CASE WHEN m.status IN ('pendente', 'erro') THEN NULL ELSE m.reservada_ate END
    FROM public.bot_conversas c
    WHERE c.id = m.conversa_id AND c.conexao_id = _conexao_id AND m.wa_id = v_waid
      AND m.direcao = CASE WHEN _ev->'deMim' = 'true'::jsonb THEN 'saida' ELSE 'entrada' END
      AND ((m.direcao = 'saida' AND m.wa_entregue_em IS NULL) OR m.status IN ('pendente', 'erro')
           OR (v_status <> 'entregue' AND m.wa_lida_em IS NULL));
    RETURN;
  END IF;

  -- Editar e apagar so valem para a mensagem da propria conversa do evento e de
  -- quem editou: o id alvo vem de dentro do conteudo, que o remetente controla.
  -- deMim/participanteJid (gateway) dizem quem editou; sem eles, so a conversa.
  v_em := COALESCE(public.bot_ts(_ev->>'waEm'), now());
  v_chat := lower(btrim(COALESCE(_ev->>'chatJid', '')));
  v_direcao := CASE jsonb_typeof(_ev->'deMim') WHEN 'boolean' THEN
                 CASE WHEN _ev->'deMim' = 'true'::jsonb THEN 'saida' ELSE 'entrada' END END;
  v_participante := CASE WHEN v_chat LIKE '%@g.us' AND v_direcao = 'entrada'
                         THEN lower(NULLIF(btrim(_ev->>'participanteJid'), '')) END;
  IF v_tipo NOT IN ('edicao', 'apagada') THEN
    RAISE EXCEPTION 'tipo desconhecido: %', left(COALESCE(v_tipo, ''), 40);
  END IF;
  IF v_chat !~ '^[0-9]+(-[0-9]+)?@(s\.whatsapp\.net|lid|g\.us)$' THEN RETURN; END IF;

  IF v_tipo = 'edicao' THEN
    -- Edicao sem texto mantem o texto anterior; 'so_metadados' nunca guarda corpo.
    UPDATE public.bot_mensagens m SET
      corpo = CASE WHEN c.privacidade = 'normal' THEN COALESCE(left(NULLIF(_ev->>'corpo', ''), 10000), m.corpo) END,
      editada_em = v_em
    FROM public.bot_conversas c
    WHERE c.id = m.conversa_id AND c.conexao_id = _conexao_id AND m.wa_id = v_waid
      AND (c.jid = v_chat OR c.lid = v_chat OR (v_chat LIKE '%@s.whatsapp.net' AND c.telefone = split_part(v_chat, '@', 1)))
      AND (v_direcao IS NULL OR m.direcao = v_direcao)
      AND (v_participante IS NULL OR lower(m.participante_jid) = v_participante)
      AND (m.editada_em IS NULL OR m.editada_em < v_em);
  ELSE
    -- So marca: guardar o corpo ou nao e decisao manual (C16).
    UPDATE public.bot_mensagens m SET apagada_em = v_em
    FROM public.bot_conversas c
    WHERE c.id = m.conversa_id AND c.conexao_id = _conexao_id AND m.wa_id = v_waid AND m.apagada_em IS NULL
      AND (c.jid = v_chat OR c.lid = v_chat OR (v_chat LIKE '%@s.whatsapp.net' AND c.telefone = split_part(v_chat, '@', 1)))
      AND (v_direcao IS NULL OR m.direcao = v_direcao)
      AND (v_participante IS NULL OR lower(m.participante_jid) = v_participante);
  END IF;
END; $function$;

-- Eventos da conexao: status, qr, codigo_pareamento, grupos, batimento.
CREATE OR REPLACE FUNCTION public.bot_evento_conexao(_conexao_id uuid, _ev jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tipo text := _ev->>'tipo';
  v_agora text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_status text; v_numero text; v_qr text; v_codigo text; v_versao text; v_grupos jsonb;
BEGIN
  IF v_tipo = 'status' THEN
    v_status := _ev->>'status';
    IF v_status IS NULL OR v_status NOT IN ('conectando', 'conectado', 'desconectado', 'deslogado',
                                            'aguardando_qr', 'aguardando_codigo', 'erro') THEN
      RAISE EXCEPTION 'status invalido';
    END IF;
    v_numero := NULLIF(regexp_replace(COALESCE(_ev->>'numero', ''), '\D', '', 'g'), '');
    UPDATE public.bot_conexoes SET
      status = v_status,
      status_detalhe = left(NULLIF(btrim(_ev->>'detalhe'), ''), 300),
      numero = CASE WHEN v_status = 'conectado' AND length(v_numero) BETWEEN 8 AND 20 THEN v_numero ELSE numero END,
      conectado_em = CASE WHEN v_status = 'conectado' THEN now() ELSE conectado_em END,
      pareamento = CASE
        WHEN v_status IN ('conectado', 'deslogado') OR pareamento IS NULL THEN NULL
        WHEN v_status IN ('aguardando_qr', 'aguardando_codigo') THEN pareamento || jsonb_build_object('estado', v_status, 'atualizadoEm', v_agora)
        WHEN v_status IN ('desconectado', 'erro') THEN (pareamento - 'qr' - 'codigo') || jsonb_build_object('estado', v_status, 'atualizadoEm', v_agora)
        ELSE pareamento END
    WHERE id = _conexao_id;
  ELSIF v_tipo = 'qr' THEN
    v_qr := left(NULLIF(btrim(_ev->>'qr'), ''), 2000);
    IF v_qr IS NULL THEN RAISE EXCEPTION 'qr vazio'; END IF;
    UPDATE public.bot_conexoes SET status = 'aguardando_qr',
      pareamento = (COALESCE(pareamento, '{}'::jsonb) - 'codigo')
                   || jsonb_build_object('estado', 'aguardando_qr', 'qr', v_qr, 'atualizadoEm', v_agora)
    WHERE id = _conexao_id;
  ELSIF v_tipo = 'codigo_pareamento' THEN
    v_codigo := upper(regexp_replace(COALESCE(_ev->>'codigo', ''), '[^0-9A-Za-z]', '', 'g'));
    IF v_codigo !~ '^[0-9A-Z]{8}$' THEN RAISE EXCEPTION 'codigo de pareamento invalido'; END IF;
    UPDATE public.bot_conexoes SET status = 'aguardando_codigo',
      pareamento = (COALESCE(pareamento, '{}'::jsonb) - 'qr')
                   || jsonb_build_object('estado', 'aguardando_codigo', 'codigo', v_codigo, 'atualizadoEm', v_agora)
    WHERE id = _conexao_id;
  ELSIF v_tipo = 'grupos' THEN
    IF jsonb_typeof(_ev->'grupos') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'grupos precisa ser lista'; END IF;
    -- so a contagem de participantes, nunca os numeros
    SELECT COALESCE(jsonb_agg(g ORDER BY g->>'nome' NULLS LAST, g->>'jid'), '[]'::jsonb) INTO v_grupos
      FROM (
        SELECT DISTINCT ON (x->>'jid') jsonb_strip_nulls(jsonb_build_object(
                 'jid', x->>'jid',
                 'nome', left(NULLIF(btrim(x->>'nome'), ''), 200),
                 'participantes', CASE WHEN jsonb_typeof(x->'participantes') = 'number' THEN (x->>'participantes')::numeric::int END)) AS g
          FROM jsonb_array_elements(_ev->'grupos') AS x
         WHERE jsonb_typeof(x) = 'object' AND x->>'jid' ~ '^[0-9]+(-[0-9]+)?@g\.us$'
         ORDER BY x->>'jid'
         LIMIT 2000) s;
    UPDATE public.bot_conexoes SET grupos_disponiveis = v_grupos WHERE id = _conexao_id;
    UPDATE public.bot_conversas c SET grupo_nome = g->>'nome'
      FROM jsonb_array_elements(v_grupos) AS g
     WHERE c.conexao_id = _conexao_id AND c.tipo = 'grupo' AND c.jid = g->>'jid'
       AND g->>'nome' IS NOT NULL AND c.grupo_nome IS DISTINCT FROM g->>'nome';
  ELSIF v_tipo = 'batimento' THEN
    v_versao := _ev->>'versao';
    IF v_versao ~ '^[0-9]{1,3}(\.[0-9]{1,3}){1,3}$' THEN
      UPDATE public.bot_conexoes SET versao = v_versao WHERE id = _conexao_id AND versao IS DISTINCT FROM v_versao;
    END IF;
  ELSE
    RAISE EXCEPTION 'tipo desconhecido: %', left(COALESCE(v_tipo, ''), 40);
  END IF;
END; $function$;

-- Evento 'chats_base' (V11): upsert sem apagar campo com null.
CREATE OR REPLACE FUNCTION public.bot_evento_chats_base(_conexao_id uuid, _ev jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF jsonb_typeof(_ev->'chats') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'chats precisa ser lista'; END IF;
  INSERT INTO public.wa_contatos_base AS t (conexao_id, jid, telefone, lid, nome, ultimo_em)
  SELECT DISTINCT ON (s.jid) _conexao_id, s.jid, s.telefone, s.lid, s.nome, s.ultimo_em
    FROM (
      SELECT lower(btrim(x->>'jid')) AS jid,
             CASE WHEN length(regexp_replace(COALESCE(x->>'telefone', ''), '\D', '', 'g')) BETWEEN 8 AND 15
                  THEN regexp_replace(x->>'telefone', '\D', '', 'g') END AS telefone,
             CASE WHEN lower(btrim(x->>'lid')) ~ '^[0-9]+@lid$' THEN lower(btrim(x->>'lid')) END AS lid,
             left(NULLIF(btrim(x->>'nome'), ''), 120) AS nome,
             public.bot_ts(x->>'ultimoEm') AS ultimo_em
        FROM jsonb_array_elements(_ev->'chats') AS x
       WHERE jsonb_typeof(x) = 'object'
       LIMIT 1000) s
   WHERE s.jid ~ '^[0-9]+@(s\.whatsapp\.net|lid)$'
   ORDER BY s.jid, s.ultimo_em DESC NULLS LAST
  ON CONFLICT (conexao_id, jid) DO UPDATE SET
    telefone = COALESCE(EXCLUDED.telefone, t.telefone),
    lid = COALESCE(EXCLUDED.lid, t.lid),
    nome = COALESCE(EXCLUDED.nome, t.nome),
    ultimo_em = GREATEST(t.ultimo_em, EXCLUDED.ultimo_em),
    updated_at = now()
  WHERE (t.telefone, t.lid, t.nome, t.ultimo_em) IS DISTINCT FROM
        (COALESCE(EXCLUDED.telefone, t.telefone), COALESCE(EXCLUDED.lid, t.lid),
         COALESCE(EXCLUDED.nome, t.nome), GREATEST(t.ultimo_em, EXCLUDED.ultimo_em));
END; $function$;

-- O lote do POST /api/bot/eventos numa ida ao banco. Evento ruim vira
-- {indice, erro} e nao derruba os outros (cada um roda num subbloco).
CREATE OR REPLACE FUNCTION public.bot_registrar_eventos(_conexao_id uuid, _eventos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cx public.bot_conexoes%ROWTYPE;
  v_ev jsonb; v_r jsonb; i int;
  v_ok int := 0;
  v_erros jsonb := '[]'::jsonb;
  v_responder jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(_eventos) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'eventos precisa ser lista'; END IF;
  -- um lote por conexao de cada vez: duas chamadas juntas nao criam a mesma conversa duas vezes
  PERFORM pg_advisory_xact_lock(hashtextextended('bot_registrar_eventos:' || _conexao_id::text, 0));
  SELECT * INTO v_cx FROM public.bot_conexoes WHERE id = _conexao_id AND arquivado_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'conexao nao encontrada'; END IF;
  UPDATE public.bot_conexoes SET visto_em = now() WHERE id = _conexao_id;

  FOR i IN 0 .. jsonb_array_length(_eventos) - 1 LOOP
    v_ev := _eventos->i;
    BEGIN
      IF jsonb_typeof(v_ev) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'evento precisa ser objeto'; END IF;
      CASE v_ev->>'tipo'
        WHEN 'mensagem' THEN
          v_r := public.bot_evento_mensagem(_conexao_id, v_cx.bot_ativo, v_cx.opcoes->'gruposPermitidos', v_ev);
          IF v_r->'responder' = 'true'::jsonb THEN
            v_responder := v_responder || jsonb_build_array(v_r || jsonb_build_object('indice', i));
          END IF;
        WHEN 'recibo', 'edicao', 'apagada' THEN
          PERFORM public.bot_evento_marcar(_conexao_id, v_ev);
        WHEN 'status', 'qr', 'codigo_pareamento', 'grupos', 'batimento' THEN
          PERFORM public.bot_evento_conexao(_conexao_id, v_ev);
        WHEN 'chats_base' THEN
          PERFORM public.bot_evento_chats_base(_conexao_id, v_ev);
        ELSE
          RAISE EXCEPTION 'tipo desconhecido: %', left(COALESCE(v_ev->>'tipo', '(vazio)'), 40);
      END CASE;
      v_ok := v_ok + 1;
    EXCEPTION WHEN others THEN
      -- Erro passageiro (deadlock, serializacao, trava, falta de recurso, cancelamento)
      -- derruba o lote: a rota responde 5xx e o gateway manda de novo. So erro do
      -- proprio evento vira recusa definitiva em erros[i] (contrato 2).
      IF left(SQLSTATE, 2) IN ('40', '53', '55', '57', '58', 'XX') THEN RAISE; END IF;
      v_erros := v_erros || jsonb_build_array(jsonb_build_object('indice', i, 'erro', left(SQLERRM, 200)));
    END;
  END LOOP;

  RETURN jsonb_build_object('processados', v_ok, 'erros', v_erros, 'responder', v_responder);
END; $function$;

-- Fila de saida com reserva. _conexao_id NULL = todas as conexoes do gateway.
-- Sai so: pendente, vencida a reserva, menos de 3 entregas, robo ligado,
-- conversa individual, texto; no gateway, nunca campanha e so para quem ja
-- escreveu (entrada gravada pela captura, nao uma coluna que o navegador mexe).
-- Conexao bloqueada espera; com limite_diario, o chip manda no maximo o saldo
-- do dia (o que ja saiu hoje e o que esta reservado contam). O que nunca vai
-- sair vira 'erro' com o motivo (sem reenvio infinito).
CREATE OR REPLACE FUNCTION public.bot_reservar_fila(_conexao_id uuid, _limite integer DEFAULT 10)
 RETURNS TABLE(id uuid, conexao_id uuid, para text, corpo text, tipo text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH julgadas AS (
    SELECT m.id, CASE
        WHEN NOT x.bot_ativo THEN 'envio_desligado'
        WHEN c.tipo <> 'individual' THEN 'destino_grupo'
        WHEN m.tipo <> 'texto' OR COALESCE(btrim(m.corpo), '') = '' THEN 'mensagem_invalida'
        WHEN m.disparo_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.bot_disparos d WHERE d.id = m.disparo_id AND d.status = 'cancelado') THEN 'campanha_cancelada'
        WHEN x.modo = 'gateway' AND (m.disparo_id IS NOT NULL OR m.autor = 'campanha') THEN 'campanha_bloqueada_no_gateway'
        WHEN x.modo = 'gateway' AND NOT EXISTS (
               SELECT 1 FROM public.bot_mensagens e WHERE e.conversa_id = c.id AND e.direcao = 'entrada') THEN 'contato_nunca_escreveu'
        WHEN m.tentativas >= 3 THEN 'sem_confirmacao' END AS motivo
      FROM public.bot_mensagens m
      JOIN public.bot_conversas c ON c.id = m.conversa_id
      JOIN public.bot_conexoes x ON x.id = c.conexao_id
     WHERE m.direcao = 'saida' AND m.status = 'pendente'
       AND CASE WHEN _conexao_id IS NULL THEN x.modo = 'gateway' ELSE x.id = _conexao_id END
       AND x.arquivado_em IS NULL AND x.desconectada_em IS NULL
       AND (m.agendado_para IS NULL OR m.agendado_para <= now())
       AND (m.reservada_ate IS NULL OR m.reservada_ate < now())
  )
  UPDATE public.bot_mensagens m SET status = 'erro', reservada_ate = NULL, erro = j.motivo
    FROM julgadas j
   WHERE m.id = j.id AND j.motivo IS NOT NULL;

  WITH saldo AS (
    SELECT x.id AS conexao_id, x.modo,
           CASE WHEN x.limite_diario IS NULL THEN NULL ELSE
             x.limite_diario
             - CASE WHEN x.contador_dia = public.bot_dia_da_conexao(x.id) THEN x.enviadas_hoje ELSE 0 END
             - (SELECT count(*) FROM public.bot_mensagens r JOIN public.bot_conversas rc ON rc.id = r.conversa_id
                 WHERE rc.conexao_id = x.id AND r.direcao = 'saida' AND r.status = 'pendente' AND r.reservada_ate >= now())
           END AS n
      FROM public.bot_conexoes x
     WHERE CASE WHEN _conexao_id IS NULL THEN x.modo = 'gateway' ELSE x.id = _conexao_id END
       AND x.arquivado_em IS NULL AND x.desconectada_em IS NULL AND x.bloqueado_em IS NULL AND x.bot_ativo
  ),
  prontas AS (
    SELECT m.id, s.n AS saldo,
           row_number() OVER (PARTITION BY s.conexao_id
                              ORDER BY COALESCE(m.agendado_para, m.created_at), m.created_at, m.id) AS ordem
      FROM public.bot_mensagens m
      JOIN public.bot_conversas c ON c.id = m.conversa_id
      JOIN saldo s ON s.conexao_id = c.conexao_id
     WHERE m.direcao = 'saida' AND m.status = 'pendente' AND m.tentativas < 3
       AND c.tipo = 'individual' AND m.tipo = 'texto' AND COALESCE(btrim(m.corpo), '') <> ''
       AND NOT (s.modo = 'gateway' AND (m.disparo_id IS NOT NULL OR m.autor = 'campanha' OR NOT EXISTS (
                  SELECT 1 FROM public.bot_mensagens e WHERE e.conversa_id = c.id AND e.direcao = 'entrada')))
       AND (m.agendado_para IS NULL OR m.agendado_para <= now())
       AND (m.reservada_ate IS NULL OR m.reservada_ate < now())
  ),
  alvo AS (
    SELECT m.id FROM public.bot_mensagens m JOIN prontas p ON p.id = m.id
     WHERE p.saldo IS NULL OR p.ordem <= p.saldo
     ORDER BY COALESCE(m.agendado_para, m.created_at), m.created_at, m.id
     LIMIT LEAST(GREATEST(COALESCE(_limite, 10), 1), 50)
     FOR UPDATE OF m SKIP LOCKED)
  UPDATE public.bot_mensagens m
     SET reservada_ate = now() + interval '15 minutes', tentativas = m.tentativas + 1, entregue_em = now()
    FROM alvo, public.bot_conversas c
   WHERE m.id = alvo.id AND c.id = m.conversa_id
  RETURNING m.id, c.conexao_id, COALESCE(c.jid, c.telefone), m.corpo, m.tipo;
$function$;

-- Confirmacao do envio (idempotente). _conexao_id NULL = qualquer conexao do gateway.
-- Devolve 'ok', 'ja_confirmada' ou 'nao_encontrada'. 'enviada' vence 'erro'.
CREATE OR REPLACE FUNCTION public.bot_confirmar_envio(_id uuid, _status text, _wa_id text DEFAULT NULL,
                                                      _erro text DEFAULT NULL, _conexao_id uuid DEFAULT NULL)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v record;
BEGIN
  IF _status IS NULL OR _status NOT IN ('enviada', 'erro') THEN RAISE EXCEPTION 'status invalido'; END IF;
  SELECT m.id, m.status, m.wa_id, c.conexao_id INTO v
    FROM public.bot_mensagens m
    JOIN public.bot_conversas c ON c.id = m.conversa_id
    JOIN public.bot_conexoes x ON x.id = c.conexao_id
   WHERE m.id = _id AND m.direcao = 'saida' AND m.origem_evento = 'fila'
     AND CASE WHEN _conexao_id IS NULL THEN x.modo = 'gateway' ELSE x.id = _conexao_id END
   FOR UPDATE OF m;
  IF NOT FOUND THEN RETURN 'nao_encontrada'; END IF;
  IF v.status = 'enviada' OR (v.status = 'erro' AND _status = 'erro') THEN RETURN 'ja_confirmada'; END IF;

  IF _status = 'enviada' THEN
    UPDATE public.bot_mensagens SET status = 'enviada', enviada_em = now(), wa_em = COALESCE(wa_em, now()),
           erro = NULL, reservada_ate = NULL
     WHERE id = _id;
    IF NULLIF(btrim(_wa_id), '') IS NOT NULL AND left(btrim(_wa_id), 120) IS DISTINCT FROM v.wa_id THEN
      BEGIN
        UPDATE public.bot_mensagens SET wa_id = left(btrim(_wa_id), 120) WHERE id = _id;
      EXCEPTION WHEN unique_violation THEN
        NULL;  -- o mesmo wa_id ja esta noutra linha da conversa: fica o reservado
      END;
    END IF;
    UPDATE public.bot_disparo_alvos SET status = 'enviado', erro = NULL WHERE mensagem_id = _id;
    PERFORM public.bot_contar_envio(v.conexao_id);
  ELSE
    UPDATE public.bot_mensagens SET status = 'erro', reservada_ate = NULL,
           erro = left(COALESCE(NULLIF(btrim(_erro), ''), 'falha no envio'), 300)
     WHERE id = _id;
    UPDATE public.bot_disparo_alvos SET status = 'erro', erro = left(COALESCE(NULLIF(btrim(_erro), ''), 'falha no envio'), 300)
     WHERE mensagem_id = _id;
  END IF;
  RETURN 'ok';
END; $function$;

-- Dados do arquivo COMPLETO (conversa exata, telefone, nome do WhatsApp) que o
-- dono baixa. So o servidor chama, depois de conferir o acesso; o texto e
-- montado no servidor e nunca gravado (nem no Storage).
-- Uma conversa (_conversa_id) ou todas da empresa (_partner_id), na janela
-- [_de, _ate) de momento. Pendente e erro nao sairam: ficam de fora.
CREATE OR REPLACE FUNCTION public.bot_arquivo_completo(_partner_id uuid, _conversa_id uuid, _de timestamptz,
                                                       _ate timestamptz, _limite integer DEFAULT 20000)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH convs AS (
    SELECT c.id, c.conexao_id, c.tipo, c.telefone, c.nome, c.jid, c.lid, c.grupo_nome, c.privacidade,
           x.nome AS conexao_nome, x.numero AS conexao_numero
      FROM public.bot_conversas c JOIN public.bot_conexoes x ON x.id = c.conexao_id
     WHERE CASE WHEN _conversa_id IS NOT NULL THEN c.id = _conversa_id
                ELSE x.escopo = 'parceiro' AND x.owner_id = _partner_id AND c.privacidade <> 'ignorar' END
  ),
  msgs AS (
    SELECT m.id, m.conversa_id, m.momento, m.direcao, m.autor, m.tipo, m.corpo, m.midia,
           m.participante_nome, m.participante_telefone, m.editada_em, m.apagada_em
      FROM convs c JOIN public.bot_mensagens m ON m.conversa_id = c.id
     WHERE m.status IN ('recebida', 'enviada')
       AND (_de IS NULL OR m.momento >= _de) AND (_ate IS NULL OR m.momento < _ate)
     ORDER BY m.momento, m.id
     LIMIT GREATEST(COALESCE(_limite, 20000), 1) + 1
  ),
  cortadas AS (
    SELECT * FROM msgs ORDER BY momento, id LIMIT GREATEST(COALESCE(_limite, 20000), 1)
  ),
  primeira AS (
    SELECT conversa_id, min(momento) AS em FROM cortadas GROUP BY conversa_id
  )
  SELECT jsonb_build_object(
    'conversas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id, 'tipo', c.tipo, 'telefone', c.telefone, 'nome', c.nome, 'jid', c.jid, 'lid', c.lid,
               'grupo_nome', c.grupo_nome, 'privacidade', c.privacidade,
               'conexao_nome', c.conexao_nome, 'conexao_numero', c.conexao_numero,
               -- o primeiro anuncio da conversa, bruto (C3): mostrar, nao concluir
               'anuncio', (SELECT a.anuncio FROM public.bot_mensagens a
                            WHERE a.conversa_id = c.id AND a.anuncio IS NOT NULL
                            ORDER BY a.momento, a.id LIMIT 1),
               'nome_celular', (SELECT b.nome FROM public.wa_contatos_base b
                                 WHERE b.conexao_id = c.conexao_id AND b.nome IS NOT NULL
                                   AND (b.jid = c.jid OR b.jid = c.lid OR b.lid = c.lid OR b.telefone = c.telefone)
                                 ORDER BY b.ultimo_em DESC NULLS LAST LIMIT 1))
             ORDER BY p.em NULLS LAST, c.id)
        FROM convs c LEFT JOIN primeira p ON p.conversa_id = c.id
       WHERE p.conversa_id IS NOT NULL OR _conversa_id IS NOT NULL), '[]'::jsonb),
    'mensagens', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.momento, m.id) FROM cortadas m), '[]'::jsonb),
    'cortado', (SELECT count(*) > GREATEST(COALESCE(_limite, 20000), 1) FROM msgs));
$function$;

-- ------------------------------------------------ 6. gatilhos
-- BEFORE roda em ordem alfabetica: preparar (autor, origem) antes da trava.
DROP TRIGGER IF EXISTS trg_bot_mensagens_1_preparar ON public.bot_mensagens;
CREATE TRIGGER trg_bot_mensagens_1_preparar BEFORE INSERT ON public.bot_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.bot_preparar_mensagem();
DROP TRIGGER IF EXISTS trg_bot_mensagens_2_trava ON public.bot_mensagens;
CREATE TRIGGER trg_bot_mensagens_2_trava BEFORE INSERT OR UPDATE OF autor, conversa_id, origem_evento, status ON public.bot_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.bot_trava_envio_automatico();
DROP TRIGGER IF EXISTS trg_bot_mensagens_relogio ON public.bot_mensagens;
CREATE TRIGGER trg_bot_mensagens_relogio AFTER INSERT OR UPDATE OF status, wa_em ON public.bot_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.bot_marcar_ultima_mensagem();
DROP TRIGGER IF EXISTS trg_bot_conversas_privacidade ON public.bot_conversas;
CREATE TRIGGER trg_bot_conversas_privacidade AFTER UPDATE OF privacidade ON public.bot_conversas
  FOR EACH ROW EXECUTE FUNCTION public.bot_conversas_privacidade();

-- wa_id reservado para o que ja estava na fila antes desta migracao
UPDATE public.bot_mensagens SET wa_id = public.bot_wa_id_da_fila(id)
 WHERE direcao = 'saida' AND status = 'pendente' AND wa_id IS NULL;

-- Relogios das conversas que ja existiam
UPDATE public.bot_conversas c SET ultima_entrada_em = s.e, ultima_saida_em = s.s
  FROM (SELECT conversa_id,
               max(momento) FILTER (WHERE direcao = 'entrada') AS e,
               max(momento) FILTER (WHERE direcao = 'saida' AND status = 'enviada' AND autor IN ('humano', 'crm')) AS s
          FROM public.bot_mensagens GROUP BY conversa_id) s
 WHERE s.conversa_id = c.id
   AND (c.ultima_entrada_em IS DISTINCT FROM s.e OR c.ultima_saida_em IS DISTINCT FROM s.s);

-- ------------------------------------------------ 7. permissoes
-- Tudo daqui so o servidor (service role) executa. As funcoes de gatilho sao
-- SECURITY DEFINER e disparam mesmo para quem nao tem EXECUTE.
DO $permissoes002$
DECLARE
  f record;
  funcoes text[] := ARRAY[
    'bot_ts', 'bot_wa_id_da_fila', 'bot_preparar_mensagem', 'bot_trava_envio_automatico',
    'bot_marcar_ultima_mensagem', 'bot_conversas_privacidade', 'bot_registrar_no_cartao',
    'bot_vincular_cartao', 'bot_fundir_conversas', 'bot_evento_mensagem', 'bot_evento_marcar',
    'bot_evento_conexao', 'bot_evento_chats_base', 'bot_registrar_eventos', 'bot_reservar_fila',
    'bot_confirmar_envio', 'bot_arquivo_completo', 'bot_apagar_texto_da_conversa'];
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS assinatura
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY (funcoes)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.assinatura);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.assinatura);
  END LOOP;
END
$permissoes002$;

-- Base de contatos: o navegador so le (pela RLS); quem grava e o servidor.
REVOKE ALL ON public.wa_contatos_base FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.wa_contatos_base FROM authenticated;
GRANT SELECT ON public.wa_contatos_base TO authenticated;
GRANT ALL ON public.wa_contatos_base TO service_role;

-- bot_conexoes: o navegador le coluna por coluna (o segredo fica de fora, 001).
GRANT SELECT (modo, bot_ativo, opcoes, pareamento, grupos_disponiveis, desconectada_em) ON public.bot_conexoes TO authenticated;

-- ------------------------------------------------ 8. o navegador nao alimenta a fila
-- As travas de banimento (so responder a quem ja escreveu, nunca campanha no
-- gateway, limite de conexoes, conexao sempre de empresa) valem na rota E aqui:
-- o navegador fala com o banco pela RLS e nao pode contorna-las gravando direto.
-- O que a fila e a captura usam (jid, telefone, lid, relogios, autor, origem,
-- wa_id, modo, pareamento, bot_ativo...) so o servidor grava.
-- Revoga antes de conceder: rodar de novo deixa o mesmo resultado.

-- bot_mensagens: o navegador le; so enfileira campanha, e so em conexao do PC.
CREATE OR REPLACE FUNCTION public.bot_trava_escrita_navegador()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- servidor (service role), funcoes do banco e migracoes passam direto
  IF current_user NOT IN ('anon', 'authenticated') THEN RETURN NEW; END IF;
  IF NEW.direcao <> 'saida' OR NEW.status <> 'pendente' OR NEW.disparo_id IS NULL THEN
    RAISE EXCEPTION 'o navegador so enfileira mensagem de campanha' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bot_disparos d WHERE d.id = NEW.disparo_id) THEN
    RAISE EXCEPTION 'campanha nao encontrada' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bot_conversas c JOIN public.bot_conexoes x ON x.id = c.conexao_id
                  WHERE c.id = NEW.conversa_id AND x.modo = 'pc') THEN
    RAISE EXCEPTION 'campanha nao sai pelo gateway: use uma conexao do computador' USING ERRCODE = 'check_violation';
  END IF;
  NEW.autor := 'campanha';
  RETURN NEW;
END; $function$;

REVOKE ALL ON FUNCTION public.bot_trava_escrita_navegador() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_trava_escrita_navegador() TO service_role;
DROP TRIGGER IF EXISTS trg_bot_mensagens_0_navegador ON public.bot_mensagens;
CREATE TRIGGER trg_bot_mensagens_0_navegador BEFORE INSERT ON public.bot_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.bot_trava_escrita_navegador();

REVOKE INSERT, UPDATE, DELETE ON public.bot_mensagens FROM authenticated;
GRANT INSERT (conversa_id, direcao, tipo, corpo, status, agendado_para, disparo_id) ON public.bot_mensagens TO authenticated;

-- bot_conversas: nada de jid, lid, relogios, tipo ou conexao depois de criada.
REVOKE INSERT, UPDATE, DELETE ON public.bot_conversas FROM authenticated;
GRANT INSERT (conexao_id, telefone, nome, estado, cartao_id) ON public.bot_conversas TO authenticated;
GRANT UPDATE (privacidade, estado) ON public.bot_conversas TO authenticated;

-- bot_conexoes: o navegador cria conexao do PC e renomeia; modo, pareamento,
-- robo ligado e desconexao so pelo servidor (rotas /api/conexoes). A policy
-- abaixo e a segunda trava; a primeira sao as colunas liberadas.
REVOKE INSERT, UPDATE ON public.bot_conexoes FROM authenticated;
GRANT INSERT (escopo, owner_id, nome, limite_diario, status) ON public.bot_conexoes TO authenticated;
GRANT UPDATE (nome, limite_diario) ON public.bot_conexoes TO authenticated;
DROP POLICY IF EXISTS "Criar conexao no meu escopo" ON public.bot_conexoes;
CREATE POLICY "Criar conexao no meu escopo" ON public.bot_conexoes AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (bot_acesso_dono(escopo, owner_id) AND modo = 'pc' AND NOT bot_ativo);

-- ------------------------------------------------ 9. assinatura do gateway nao se repete
-- A mesma requisicao assinada (HMAC) vale por 5 minutos; quem a capturar nao pode
-- reenviar. Guarda as assinaturas aceitas ate o fim da janela. So o servidor usa.
CREATE TABLE IF NOT EXISTS public.gateway_assinaturas_vistas (
  assinatura text PRIMARY KEY,
  expira_em timestamptz NOT NULL
);
ALTER TABLE public.gateway_assinaturas_vistas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gateway_assinaturas_vistas FROM anon, authenticated;
GRANT ALL ON public.gateway_assinaturas_vistas TO service_role;

-- true = primeira vez (aceita); false = ja vista (recusa).
CREATE OR REPLACE FUNCTION public.bot_gateway_assinatura_nova(_assinatura text, _expira_em timestamptz)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n int;
BEGIN
  DELETE FROM public.gateway_assinaturas_vistas WHERE expira_em < now();
  INSERT INTO public.gateway_assinaturas_vistas (assinatura, expira_em)
  VALUES (lower(left(_assinatura, 64)), _expira_em)
  ON CONFLICT (assinatura) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END; $function$;
REVOKE ALL ON FUNCTION public.bot_gateway_assinatura_nova(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_gateway_assinatura_nova(text, timestamptz) TO service_role;

COMMIT;
