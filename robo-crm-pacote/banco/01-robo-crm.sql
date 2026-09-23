-- ============================================================
-- Robo de WhatsApp + CRM -- schema extraido do banco em producao
-- Gerado de pg_catalog, NAO das migrations: em 11/09/2026 so 3 das
-- 18 funcoes do banco batiam com alguma migration do repositorio.
-- ============================================================

-- ---------------------------------------------------- 1. TABELAS
-- Dependem de public.profiles (e crm_cartoes de public.leads),
-- que NAO estao aqui: ver banco/LEIA-ME.md.

CREATE TABLE public.bot_conexoes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  escopo text NOT NULL,
  owner_id uuid,
  nome text NOT NULL,
  provedor text DEFAULT 'nao_oficial'::text NOT NULL,
  numero text,
  status text DEFAULT 'desconectado'::text NOT NULL,
  status_detalhe text,
  webhook_segredo text DEFAULT (replace((gen_random_uuid())::text, '-'::text, ''::text) || replace((gen_random_uuid())::text, '-'::text, ''::text)) NOT NULL,
  conectado_em timestamp with time zone,
  visto_em timestamp with time zone,
  arquivado_em timestamp with time zone,
  criado_por uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  prioridade integer DEFAULT 100 NOT NULL,
  falhas_seguidas integer DEFAULT 0 NOT NULL,
  bloqueado_em timestamp with time zone,
  bloqueado_motivo text,
  limite_diario integer,
  enviadas_hoje integer DEFAULT 0 NOT NULL,
  contador_dia date,
  uso text DEFAULT 'atendimento'::text NOT NULL,
  versao text
);

CREATE TABLE public.bot_conversas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conexao_id uuid NOT NULL,
  telefone text NOT NULL,
  nome text,
  fluxo_id uuid,
  passo_atual_id uuid,
  estado text DEFAULT 'bot'::text NOT NULL,
  profile_id uuid,
  cartao_id uuid,
  ultima_mensagem_em timestamp with time zone,
  encerrada_em timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  jid text,
  tentativas_passo integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.bot_disparo_alvos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  disparo_id uuid NOT NULL,
  telefone text NOT NULL,
  nome text,
  cartao_id uuid,
  status text DEFAULT 'pendente'::text NOT NULL,
  mensagem_id uuid,
  erro text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.bot_disparos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  escopo text NOT NULL,
  owner_id uuid,
  nome text NOT NULL,
  mensagem text NOT NULL,
  uso text DEFAULT 'atendimento'::text NOT NULL,
  status text DEFAULT 'rascunho'::text NOT NULL,
  agendado_para timestamp with time zone,
  intervalo_segundos smallint DEFAULT 20 NOT NULL,
  iniciado_em timestamp with time zone,
  concluido_em timestamp with time zone,
  criado_por uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  automatico boolean DEFAULT false NOT NULL
);

CREATE TABLE public.bot_fluxos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  escopo text NOT NULL,
  owner_id uuid,
  nome text NOT NULL,
  descricao text,
  gatilho_tipo text DEFAULT 'primeira_mensagem'::text NOT NULL,
  gatilho_valor text,
  ativo boolean DEFAULT false NOT NULL,
  modelo boolean DEFAULT false NOT NULL,
  clonado_de uuid,
  passo_inicial_id uuid,
  arquivado_em timestamp with time zone,
  criado_por uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.bot_mensagens (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversa_id uuid NOT NULL,
  direcao text NOT NULL,
  tipo text DEFAULT 'texto'::text NOT NULL,
  corpo text,
  midia_url text,
  wa_id text,
  enviada_por uuid,
  status text DEFAULT 'recebida'::text NOT NULL,
  tentativas smallint DEFAULT 0 NOT NULL,
  enviada_em timestamp with time zone,
  erro text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  agendado_para timestamp with time zone,
  disparo_id uuid,
  entregue_em timestamp with time zone
);

CREATE TABLE public.bot_opcoes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  passo_id uuid NOT NULL,
  rotulo text NOT NULL,
  gatilho text NOT NULL,
  proximo_passo_id uuid,
  posicao double precision DEFAULT 1000 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  sinonimos text[] DEFAULT '{}'::text[] NOT NULL
);

CREATE TABLE public.bot_passos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  fluxo_id uuid NOT NULL,
  chave text NOT NULL,
  tipo text DEFAULT 'mensagem'::text NOT NULL,
  conteudo text,
  posicao double precision DEFAULT 1000 NOT NULL,
  proximo_passo_id uuid,
  acao text,
  acao_params jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.bot_verificacoes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  token text NOT NULL,
  finalidade text DEFAULT 'cadastro'::text NOT NULL,
  profile_id uuid,
  email text,
  telefone text,
  nome_whatsapp text,
  conexao_id uuid,
  conversa_id uuid,
  verificado_em timestamp with time zone,
  expira_em timestamp with time zone DEFAULT (now() + '00:30:00'::interval) NOT NULL,
  tentativas smallint DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.crm_atividades (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  cartao_id uuid NOT NULL,
  tipo text NOT NULL,
  corpo text,
  de_coluna_id uuid,
  para_coluna_id uuid,
  meta jsonb,
  criado_por uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.crm_cartao_etiquetas (
  cartao_id uuid NOT NULL,
  etiqueta_id uuid NOT NULL
);

CREATE TABLE public.crm_cartoes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  quadro_id uuid NOT NULL,
  coluna_id uuid NOT NULL,
  posicao double precision DEFAULT 1000 NOT NULL,
  titulo text NOT NULL,
  descricao text,
  lead_id uuid,
  profile_id uuid,
  contato_nome text,
  contato_telefone text,
  contato_email text,
  responsavel_id uuid,
  vence_em timestamp with time zone,
  prioridade text DEFAULT 'normal'::text NOT NULL,
  arquivado_em timestamp with time zone,
  criado_por uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  origem text
);

CREATE TABLE public.crm_colunas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  quadro_id uuid NOT NULL,
  nome text NOT NULL,
  posicao double precision DEFAULT 1000 NOT NULL,
  cor text,
  tipo text DEFAULT 'normal'::text NOT NULL,
  limite_cartoes integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.crm_etiquetas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  quadro_id uuid NOT NULL,
  nome text NOT NULL,
  cor text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.crm_quadros (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  escopo text NOT NULL,
  owner_id uuid,
  nome text NOT NULL,
  descricao text,
  modelo boolean DEFAULT false NOT NULL,
  clonado_de uuid,
  arquivado_em timestamp with time zone,
  criado_por uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  tipo text DEFAULT 'funil'::text NOT NULL
);

-- ---------------------------------------- 2. CHAVES E RESTRICOES
ALTER TABLE public.bot_conexoes ADD CONSTRAINT bot_conexoes_pkey PRIMARY KEY (id);
ALTER TABLE public.bot_conversas ADD CONSTRAINT bot_conversas_pkey PRIMARY KEY (id);
ALTER TABLE public.bot_disparo_alvos ADD CONSTRAINT bot_disparo_alvos_pkey PRIMARY KEY (id);
ALTER TABLE public.bot_disparos ADD CONSTRAINT bot_disparos_pkey PRIMARY KEY (id);
ALTER TABLE public.bot_fluxos ADD CONSTRAINT bot_fluxos_pkey PRIMARY KEY (id);
ALTER TABLE public.bot_mensagens ADD CONSTRAINT bot_mensagens_pkey PRIMARY KEY (id);
ALTER TABLE public.bot_opcoes ADD CONSTRAINT bot_opcoes_pkey PRIMARY KEY (id);
ALTER TABLE public.bot_passos ADD CONSTRAINT bot_passos_pkey PRIMARY KEY (id);
ALTER TABLE public.bot_verificacoes ADD CONSTRAINT bot_verificacoes_pkey PRIMARY KEY (id);
ALTER TABLE public.crm_atividades ADD CONSTRAINT crm_atividades_pkey PRIMARY KEY (id);
ALTER TABLE public.crm_cartao_etiquetas ADD CONSTRAINT crm_cartao_etiquetas_pkey PRIMARY KEY (cartao_id, etiqueta_id);
ALTER TABLE public.crm_cartoes ADD CONSTRAINT crm_cartoes_pkey PRIMARY KEY (id);
ALTER TABLE public.crm_colunas ADD CONSTRAINT crm_colunas_pkey PRIMARY KEY (id);
ALTER TABLE public.crm_etiquetas ADD CONSTRAINT crm_etiquetas_pkey PRIMARY KEY (id);
ALTER TABLE public.crm_quadros ADD CONSTRAINT crm_quadros_pkey PRIMARY KEY (id);
ALTER TABLE public.bot_conversas ADD CONSTRAINT bot_conversas_unica UNIQUE (conexao_id, telefone);
ALTER TABLE public.bot_disparo_alvos ADD CONSTRAINT bot_disparo_alvo_unico UNIQUE (disparo_id, telefone);
ALTER TABLE public.bot_passos ADD CONSTRAINT bot_passos_chave_unica UNIQUE (fluxo_id, chave);
ALTER TABLE public.bot_verificacoes ADD CONSTRAINT bot_verificacoes_token_key UNIQUE (token);
ALTER TABLE public.bot_conexoes ADD CONSTRAINT bot_conexoes_escopo_check CHECK ((escopo = ANY (ARRAY['parceiro'::text, 'coach'::text, 'profissional'::text, 'admin'::text])));
ALTER TABLE public.bot_conexoes ADD CONSTRAINT bot_conexoes_owner_coerente CHECK ((((escopo = 'admin'::text) AND (owner_id IS NULL)) OR ((escopo <> 'admin'::text) AND (owner_id IS NOT NULL))));
ALTER TABLE public.bot_conexoes ADD CONSTRAINT bot_conexoes_provedor_check CHECK ((provedor = ANY (ARRAY['nao_oficial'::text, 'oficial'::text])));
ALTER TABLE public.bot_conexoes ADD CONSTRAINT bot_conexoes_status_check CHECK ((status = ANY (ARRAY['desconectado'::text, 'aguardando_qr'::text, 'conectado'::text, 'erro'::text])));
ALTER TABLE public.bot_conexoes ADD CONSTRAINT bot_conexoes_uso_valido CHECK ((uso = ANY (ARRAY['atendimento'::text, 'plataforma'::text])));
ALTER TABLE public.bot_conversas ADD CONSTRAINT bot_conversas_estado_check CHECK ((estado = ANY (ARRAY['bot'::text, 'humano'::text, 'encerrada'::text])));
ALTER TABLE public.bot_disparo_alvos ADD CONSTRAINT bot_disparo_alvos_status_check CHECK ((status = ANY (ARRAY['pendente'::text, 'enfileirado'::text, 'enviado'::text, 'erro'::text, 'ignorado'::text])));
ALTER TABLE public.bot_disparos ADD CONSTRAINT bot_disparos_escopo_check CHECK ((escopo = ANY (ARRAY['parceiro'::text, 'coach'::text, 'profissional'::text, 'admin'::text])));
ALTER TABLE public.bot_disparos ADD CONSTRAINT bot_disparos_intervalo_segundos_check CHECK ((intervalo_segundos >= 5));
ALTER TABLE public.bot_disparos ADD CONSTRAINT bot_disparos_status_check CHECK ((status = ANY (ARRAY['rascunho'::text, 'enfileirando'::text, 'enviando'::text, 'concluido'::text, 'cancelado'::text])));
ALTER TABLE public.bot_disparos ADD CONSTRAINT bot_disparos_uso_check CHECK ((uso = ANY (ARRAY['atendimento'::text, 'plataforma'::text])));
ALTER TABLE public.bot_fluxos ADD CONSTRAINT bot_fluxos_escopo_check CHECK ((escopo = ANY (ARRAY['parceiro'::text, 'coach'::text, 'profissional'::text, 'admin'::text])));
ALTER TABLE public.bot_fluxos ADD CONSTRAINT bot_fluxos_gatilho_coerente CHECK (((gatilho_tipo <> 'palavra_chave'::text) OR ((gatilho_valor IS NOT NULL) AND (gatilho_valor <> ''::text))));
ALTER TABLE public.bot_fluxos ADD CONSTRAINT bot_fluxos_gatilho_tipo_check CHECK ((gatilho_tipo = ANY (ARRAY['primeira_mensagem'::text, 'palavra_chave'::text, 'manual'::text])));
ALTER TABLE public.bot_fluxos ADD CONSTRAINT bot_fluxos_owner_coerente CHECK ((((escopo = 'admin'::text) AND (owner_id IS NULL)) OR ((escopo <> 'admin'::text) AND (owner_id IS NOT NULL))));
ALTER TABLE public.bot_mensagens ADD CONSTRAINT bot_mensagens_direcao_check CHECK ((direcao = ANY (ARRAY['entrada'::text, 'saida'::text])));
ALTER TABLE public.bot_mensagens ADD CONSTRAINT bot_mensagens_status_check CHECK ((status = ANY (ARRAY['recebida'::text, 'pendente'::text, 'enviada'::text, 'erro'::text])));
ALTER TABLE public.bot_mensagens ADD CONSTRAINT bot_mensagens_status_coerente CHECK ((((direcao = 'entrada'::text) AND (status = 'recebida'::text)) OR (direcao = 'saida'::text)));
ALTER TABLE public.bot_mensagens ADD CONSTRAINT bot_mensagens_tipo_check CHECK ((tipo = ANY (ARRAY['texto'::text, 'imagem'::text, 'audio'::text, 'video'::text, 'documento'::text, 'sistema'::text])));
ALTER TABLE public.bot_passos ADD CONSTRAINT bot_passos_tipo_check CHECK ((tipo = ANY (ARRAY['mensagem'::text, 'pergunta'::text, 'acao'::text, 'transferir'::text, 'encerrar'::text])));
ALTER TABLE public.bot_verificacoes ADD CONSTRAINT bot_verificacoes_finalidade_check CHECK ((finalidade = ANY (ARRAY['cadastro'::text, 'login'::text, 'trocar_telefone'::text, 'lead'::text])));
ALTER TABLE public.crm_atividades ADD CONSTRAINT crm_atividades_tipo_check CHECK ((tipo = ANY (ARRAY['comentario'::text, 'mudanca_coluna'::text, 'ligacao'::text, 'whatsapp'::text, 'email'::text, 'visita'::text, 'tarefa'::text, 'sistema'::text])));
ALTER TABLE public.crm_cartoes ADD CONSTRAINT crm_cartoes_prioridade_check CHECK ((prioridade = ANY (ARRAY['baixa'::text, 'normal'::text, 'alta'::text])));
ALTER TABLE public.crm_colunas ADD CONSTRAINT crm_colunas_limite_cartoes_check CHECK (((limite_cartoes IS NULL) OR (limite_cartoes > 0)));
ALTER TABLE public.crm_colunas ADD CONSTRAINT crm_colunas_tipo_check CHECK ((tipo = ANY (ARRAY['normal'::text, 'ganho'::text, 'perdido'::text])));
ALTER TABLE public.crm_quadros ADD CONSTRAINT crm_quadros_escopo_check CHECK ((escopo = ANY (ARRAY['parceiro'::text, 'coach'::text, 'profissional'::text, 'admin'::text])));
ALTER TABLE public.crm_quadros ADD CONSTRAINT crm_quadros_owner_coerente CHECK ((((escopo = 'admin'::text) AND (owner_id IS NULL)) OR ((escopo <> 'admin'::text) AND (owner_id IS NOT NULL))));
ALTER TABLE public.crm_quadros ADD CONSTRAINT crm_quadros_tipo_valido CHECK ((tipo = ANY (ARRAY['funil'::text, 'quadro'::text])));
ALTER TABLE public.bot_conexoes ADD CONSTRAINT bot_conexoes_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.bot_conversas ADD CONSTRAINT bot_conversas_cartao_id_fkey FOREIGN KEY (cartao_id) REFERENCES crm_cartoes(id) ON DELETE SET NULL;
ALTER TABLE public.bot_conversas ADD CONSTRAINT bot_conversas_conexao_id_fkey FOREIGN KEY (conexao_id) REFERENCES bot_conexoes(id) ON DELETE CASCADE;
ALTER TABLE public.bot_conversas ADD CONSTRAINT bot_conversas_fluxo_id_fkey FOREIGN KEY (fluxo_id) REFERENCES bot_fluxos(id) ON DELETE SET NULL;
ALTER TABLE public.bot_conversas ADD CONSTRAINT bot_conversas_passo_atual_id_fkey FOREIGN KEY (passo_atual_id) REFERENCES bot_passos(id) ON DELETE SET NULL;
ALTER TABLE public.bot_conversas ADD CONSTRAINT bot_conversas_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.bot_disparo_alvos ADD CONSTRAINT bot_disparo_alvos_cartao_id_fkey FOREIGN KEY (cartao_id) REFERENCES crm_cartoes(id) ON DELETE SET NULL;
ALTER TABLE public.bot_disparo_alvos ADD CONSTRAINT bot_disparo_alvos_disparo_id_fkey FOREIGN KEY (disparo_id) REFERENCES bot_disparos(id) ON DELETE CASCADE;
ALTER TABLE public.bot_disparo_alvos ADD CONSTRAINT bot_disparo_alvos_mensagem_id_fkey FOREIGN KEY (mensagem_id) REFERENCES bot_mensagens(id) ON DELETE SET NULL;
ALTER TABLE public.bot_disparos ADD CONSTRAINT bot_disparos_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.bot_fluxos ADD CONSTRAINT bot_fluxos_clonado_de_fkey FOREIGN KEY (clonado_de) REFERENCES bot_fluxos(id) ON DELETE SET NULL;
ALTER TABLE public.bot_fluxos ADD CONSTRAINT bot_fluxos_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.bot_fluxos ADD CONSTRAINT bot_fluxos_passo_inicial_fk FOREIGN KEY (passo_inicial_id) REFERENCES bot_passos(id) ON DELETE SET NULL;
ALTER TABLE public.bot_mensagens ADD CONSTRAINT bot_mensagens_conversa_id_fkey FOREIGN KEY (conversa_id) REFERENCES bot_conversas(id) ON DELETE CASCADE;
ALTER TABLE public.bot_mensagens ADD CONSTRAINT bot_mensagens_disparo_fk FOREIGN KEY (disparo_id) REFERENCES bot_disparos(id) ON DELETE SET NULL;
ALTER TABLE public.bot_mensagens ADD CONSTRAINT bot_mensagens_enviada_por_fkey FOREIGN KEY (enviada_por) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.bot_opcoes ADD CONSTRAINT bot_opcoes_passo_id_fkey FOREIGN KEY (passo_id) REFERENCES bot_passos(id) ON DELETE CASCADE;
ALTER TABLE public.bot_opcoes ADD CONSTRAINT bot_opcoes_proximo_passo_id_fkey FOREIGN KEY (proximo_passo_id) REFERENCES bot_passos(id) ON DELETE SET NULL;
ALTER TABLE public.bot_passos ADD CONSTRAINT bot_passos_fluxo_id_fkey FOREIGN KEY (fluxo_id) REFERENCES bot_fluxos(id) ON DELETE CASCADE;
ALTER TABLE public.bot_passos ADD CONSTRAINT bot_passos_proximo_passo_id_fkey FOREIGN KEY (proximo_passo_id) REFERENCES bot_passos(id) ON DELETE SET NULL;
ALTER TABLE public.bot_verificacoes ADD CONSTRAINT bot_verificacoes_conexao_id_fkey FOREIGN KEY (conexao_id) REFERENCES bot_conexoes(id) ON DELETE SET NULL;
ALTER TABLE public.bot_verificacoes ADD CONSTRAINT bot_verificacoes_conversa_id_fkey FOREIGN KEY (conversa_id) REFERENCES bot_conversas(id) ON DELETE SET NULL;
ALTER TABLE public.bot_verificacoes ADD CONSTRAINT bot_verificacoes_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.crm_atividades ADD CONSTRAINT crm_atividades_cartao_id_fkey FOREIGN KEY (cartao_id) REFERENCES crm_cartoes(id) ON DELETE CASCADE;
ALTER TABLE public.crm_atividades ADD CONSTRAINT crm_atividades_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.crm_atividades ADD CONSTRAINT crm_atividades_de_coluna_id_fkey FOREIGN KEY (de_coluna_id) REFERENCES crm_colunas(id) ON DELETE SET NULL;
ALTER TABLE public.crm_atividades ADD CONSTRAINT crm_atividades_para_coluna_id_fkey FOREIGN KEY (para_coluna_id) REFERENCES crm_colunas(id) ON DELETE SET NULL;
ALTER TABLE public.crm_cartao_etiquetas ADD CONSTRAINT crm_cartao_etiquetas_cartao_id_fkey FOREIGN KEY (cartao_id) REFERENCES crm_cartoes(id) ON DELETE CASCADE;
ALTER TABLE public.crm_cartao_etiquetas ADD CONSTRAINT crm_cartao_etiquetas_etiqueta_id_fkey FOREIGN KEY (etiqueta_id) REFERENCES crm_etiquetas(id) ON DELETE CASCADE;
ALTER TABLE public.crm_cartoes ADD CONSTRAINT crm_cartoes_coluna_id_fkey FOREIGN KEY (coluna_id) REFERENCES crm_colunas(id) ON DELETE CASCADE;
ALTER TABLE public.crm_cartoes ADD CONSTRAINT crm_cartoes_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.crm_cartoes ADD CONSTRAINT crm_cartoes_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE public.crm_cartoes ADD CONSTRAINT crm_cartoes_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.crm_cartoes ADD CONSTRAINT crm_cartoes_quadro_id_fkey FOREIGN KEY (quadro_id) REFERENCES crm_quadros(id) ON DELETE CASCADE;
ALTER TABLE public.crm_cartoes ADD CONSTRAINT crm_cartoes_responsavel_id_fkey FOREIGN KEY (responsavel_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.crm_colunas ADD CONSTRAINT crm_colunas_quadro_id_fkey FOREIGN KEY (quadro_id) REFERENCES crm_quadros(id) ON DELETE CASCADE;
ALTER TABLE public.crm_etiquetas ADD CONSTRAINT crm_etiquetas_quadro_id_fkey FOREIGN KEY (quadro_id) REFERENCES crm_quadros(id) ON DELETE CASCADE;
ALTER TABLE public.crm_quadros ADD CONSTRAINT crm_quadros_clonado_de_fkey FOREIGN KEY (clonado_de) REFERENCES crm_quadros(id) ON DELETE SET NULL;
ALTER TABLE public.crm_quadros ADD CONSTRAINT crm_quadros_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES profiles(id) ON DELETE SET NULL;

-- --------------------------------------------------- 3. INDICES
CREATE INDEX idx_bot_conexoes_dono ON public.bot_conexoes USING btree (escopo, owner_id);
CREATE INDEX idx_bot_conexoes_saudaveis ON public.bot_conexoes USING btree (escopo, owner_id, uso, prioridade) WHERE ((arquivado_em IS NULL) AND (bloqueado_em IS NULL));
CREATE INDEX bot_conversas_jid ON public.bot_conversas USING btree (conexao_id, jid) WHERE (jid IS NOT NULL);
CREATE INDEX idx_bot_conversas_cartao ON public.bot_conversas USING btree (cartao_id);
CREATE INDEX idx_bot_conversas_conexao ON public.bot_conversas USING btree (conexao_id, ultima_mensagem_em DESC);
CREATE INDEX idx_bot_conversas_estado ON public.bot_conversas USING btree (estado) WHERE (estado = 'humano'::text);
CREATE INDEX idx_bot_disparo_alvos_fila ON public.bot_disparo_alvos USING btree (disparo_id, status) WHERE (status = 'pendente'::text);
CREATE INDEX idx_bot_disparos_dono ON public.bot_disparos USING btree (escopo, owner_id, status);
CREATE INDEX idx_bot_fluxos_ativo ON public.bot_fluxos USING btree (ativo) WHERE (ativo = true);
CREATE INDEX idx_bot_fluxos_dono ON public.bot_fluxos USING btree (escopo, owner_id);
CREATE INDEX idx_bot_fluxos_modelo ON public.bot_fluxos USING btree (modelo) WHERE (modelo = true);
CREATE INDEX idx_bot_mensagens_conversa ON public.bot_mensagens USING btree (conversa_id, created_at DESC);
CREATE INDEX idx_bot_mensagens_disparo ON public.bot_mensagens USING btree (disparo_id) WHERE (disparo_id IS NOT NULL);
CREATE INDEX idx_bot_mensagens_fila ON public.bot_mensagens USING btree (agendado_para, created_at) WHERE (status = 'pendente'::text);
CREATE UNIQUE INDEX idx_bot_mensagens_wa_id ON public.bot_mensagens USING btree (conversa_id, wa_id) WHERE (wa_id IS NOT NULL);
CREATE INDEX idx_bot_opcoes_passo ON public.bot_opcoes USING btree (passo_id, posicao);
CREATE INDEX idx_bot_passos_fluxo ON public.bot_passos USING btree (fluxo_id, posicao);
CREATE INDEX idx_bot_verificacoes_abertas ON public.bot_verificacoes USING btree (token) WHERE (verificado_em IS NULL);
CREATE INDEX idx_bot_verificacoes_profile ON public.bot_verificacoes USING btree (profile_id);
CREATE INDEX idx_crm_atividades_cartao ON public.crm_atividades USING btree (cartao_id, created_at DESC);
CREATE INDEX idx_crm_cartoes_coluna ON public.crm_cartoes USING btree (coluna_id, posicao);
CREATE INDEX idx_crm_cartoes_lead ON public.crm_cartoes USING btree (lead_id);
CREATE INDEX idx_crm_cartoes_quadro ON public.crm_cartoes USING btree (quadro_id);
CREATE INDEX idx_crm_cartoes_responsavel ON public.crm_cartoes USING btree (responsavel_id);
CREATE INDEX idx_crm_cartoes_telefone ON public.crm_cartoes USING btree (quadro_id, contato_telefone) WHERE (contato_telefone IS NOT NULL);
CREATE INDEX idx_crm_cartoes_vence ON public.crm_cartoes USING btree (vence_em) WHERE (arquivado_em IS NULL);
CREATE INDEX idx_crm_colunas_quadro ON public.crm_colunas USING btree (quadro_id, posicao);
CREATE INDEX idx_crm_etiquetas_quadro ON public.crm_etiquetas USING btree (quadro_id);
CREATE INDEX idx_crm_quadros_dono ON public.crm_quadros USING btree (escopo, owner_id);
CREATE INDEX idx_crm_quadros_modelo ON public.crm_quadros USING btree (modelo) WHERE (modelo = true);
CREATE INDEX idx_crm_quadros_tipo ON public.crm_quadros USING btree (escopo, owner_id, tipo);

-- --------------------------------------------------- 4. FUNCOES

CREATE OR REPLACE FUNCTION public.bot_acesso_conexao(_conexao_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ SELECT COALESCE((SELECT public.bot_acesso_dono(c.escopo, c.owner_id) FROM public.bot_conexoes c WHERE c.id = _conexao_id), false) $function$
;

CREATE OR REPLACE FUNCTION public.bot_acesso_dono(_escopo text, _owner_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(public.is_admin(auth.uid()), false)
  OR CASE _escopo
    WHEN 'parceiro' THEN public.partner_pode(_owner_id, 'robo')
    WHEN 'coach' THEN EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = _owner_id AND pr.user_id = auth.uid())
    WHEN 'profissional' THEN EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = _owner_id AND pr.user_id = auth.uid())
    WHEN 'admin' THEN COALESCE(public.is_admin(auth.uid()), false)
    ELSE false
  END
$function$
;

CREATE OR REPLACE FUNCTION public.bot_acesso_fluxo(_fluxo_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ SELECT COALESCE((SELECT public.bot_acesso_dono(f.escopo, f.owner_id) FROM public.bot_fluxos f WHERE f.id = _fluxo_id), false) $function$
;

CREATE OR REPLACE FUNCTION public.bot_bloquear_conexao(_conexao_id uuid, _motivo text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.bot_conexoes
  SET bloqueado_em = now(), bloqueado_motivo = left(COALESCE(_motivo,'sem motivo'),300), status = 'erro'
  WHERE id = _conexao_id
$function$
;

CREATE OR REPLACE FUNCTION public.bot_clonar_fluxo(_origem_id uuid, _escopo text, _owner_id uuid, _nome text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_novo uuid; v_criador uuid;
BEGIN
  IF NOT (public.bot_acesso_fluxo(_origem_id) OR EXISTS (SELECT 1 FROM public.bot_fluxos WHERE id = _origem_id AND modelo = true)) THEN
    RAISE EXCEPTION 'Sem acesso ao fluxo de origem';
  END IF;
  IF NOT public.bot_acesso_dono(_escopo, _owner_id) THEN
    RAISE EXCEPTION 'Sem permissao para criar fluxo nesse destino';
  END IF;
  SELECT pr.id INTO v_criador FROM public.profiles pr WHERE pr.user_id = auth.uid() LIMIT 1;
  INSERT INTO public.bot_fluxos (escopo, owner_id, nome, descricao, gatilho_tipo, gatilho_valor, ativo, clonado_de, criado_por)
  SELECT _escopo, _owner_id, COALESCE(_nome, f.nome), f.descricao, f.gatilho_tipo, f.gatilho_valor, false, f.id, v_criador
  FROM public.bot_fluxos f WHERE f.id = _origem_id RETURNING id INTO v_novo;
  INSERT INTO public.bot_passos (fluxo_id, chave, tipo, conteudo, posicao, acao, acao_params)
  SELECT v_novo, p.chave, p.tipo, p.conteudo, p.posicao, p.acao, p.acao_params FROM public.bot_passos p WHERE p.fluxo_id = _origem_id;
  UPDATE public.bot_passos np SET proximo_passo_id = destino.id
  FROM public.bot_passos op
  JOIN public.bot_passos op_alvo ON op_alvo.id = op.proximo_passo_id
  JOIN public.bot_passos destino ON destino.fluxo_id = v_novo AND destino.chave = op_alvo.chave
  WHERE op.fluxo_id = _origem_id AND np.fluxo_id = v_novo AND np.chave = op.chave;
  INSERT INTO public.bot_opcoes (passo_id, rotulo, gatilho, proximo_passo_id, posicao)
  SELECT np.id, o.rotulo, o.gatilho, destino.id, o.posicao
  FROM public.bot_opcoes o
  JOIN public.bot_passos op ON op.id = o.passo_id AND op.fluxo_id = _origem_id
  JOIN public.bot_passos np ON np.fluxo_id = v_novo AND np.chave = op.chave
  LEFT JOIN public.bot_passos op_alvo ON op_alvo.id = o.proximo_passo_id
  LEFT JOIN public.bot_passos destino ON destino.fluxo_id = v_novo AND destino.chave = op_alvo.chave;
  UPDATE public.bot_fluxos nf SET passo_inicial_id = destino.id
  FROM public.bot_fluxos origem
  JOIN public.bot_passos inicial ON inicial.id = origem.passo_inicial_id
  JOIN public.bot_passos destino ON destino.fluxo_id = v_novo AND destino.chave = inicial.chave
  WHERE origem.id = _origem_id AND nf.id = v_novo;
  RETURN v_novo;
END; $function$
;

CREATE OR REPLACE FUNCTION public.bot_confirmar_verificacao(_token text, _telefone text, _conexao_id uuid DEFAULT NULL::uuid, _conversa_id uuid DEFAULT NULL::uuid, _nome text DEFAULT NULL::text)
 RETURNS TABLE(ok boolean, motivo text, profile_id uuid, finalidade text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v public.bot_verificacoes%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.bot_verificacoes WHERE upper(token) = upper(trim(_token)) LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'token nao encontrado'::text, NULL::uuid, NULL::text; RETURN;
  END IF;
  IF v.verificado_em IS NOT NULL THEN
    RETURN QUERY SELECT false, 'ja usado'::text, v.profile_id, v.finalidade; RETURN;
  END IF;
  IF v.expira_em < now() THEN
    RETURN QUERY SELECT false, 'expirado'::text, v.profile_id, v.finalidade; RETURN;
  END IF;
  UPDATE public.bot_verificacoes
  SET verificado_em = now(),
      telefone = regexp_replace(COALESCE(_telefone,''), '\D', '', 'g'),
      nome_whatsapp = COALESCE(_nome, nome_whatsapp),
      conexao_id = COALESCE(_conexao_id, conexao_id),
      conversa_id = COALESCE(_conversa_id, conversa_id),
      tentativas = tentativas + 1
  WHERE id = v.id;
  RETURN QUERY SELECT true, 'ok'::text, v.profile_id, v.finalidade;
END; $function$
;

CREATE OR REPLACE FUNCTION public.bot_contar_envio(_conexao_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.bot_conexoes
     SET enviadas_hoje = CASE
           WHEN contador_dia = public.bot_dia_da_conexao(_conexao_id) THEN enviadas_hoje + 1
           ELSE 1 END,
         contador_dia = public.bot_dia_da_conexao(_conexao_id)
   WHERE id = _conexao_id;
$function$
;

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
           'America/Sao_Paulo'))::date;
$function$
;

CREATE OR REPLACE FUNCTION public.bot_escolher_conexao(_escopo text, _owner_id uuid, _uso text DEFAULT 'atendimento'::text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.id FROM public.bot_conexoes c
  WHERE c.uso = _uso AND c.escopo = _escopo
    AND (
      c.owner_id = _owner_id
      -- Academias que dividem equipamento dividem tambem o numero. Cada uma
      -- monta as proprias campanhas; o chip que sai e o mesmo.
      OR (_owner_id IS NOT NULL AND c.owner_id IN (
            SELECT g.partner_id FROM public.academia_parceiros_do_grupo(_owner_id) g))
      OR (_owner_id IS NULL AND c.owner_id IS NULL)
    )
    AND c.arquivado_em IS NULL AND c.bloqueado_em IS NULL
    AND c.status = 'conectado' AND c.visto_em > now() - interval '5 minutes'
    AND (c.limite_diario IS NULL
      OR c.contador_dia IS DISTINCT FROM public.bot_dia_da_conexao(c.id)
      OR c.enviadas_hoje < c.limite_diario)
  ORDER BY c.prioridade,
           CASE WHEN c.contador_dia = public.bot_dia_da_conexao(c.id) THEN c.enviadas_hoje ELSE 0 END,
           c.conectado_em NULLS LAST
  LIMIT 1
$function$
;

CREATE OR REPLACE FUNCTION public.bot_marcar_ultima_mensagem()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ BEGIN
  UPDATE public.bot_conversas SET ultima_mensagem_em = NEW.created_at WHERE id = NEW.conversa_id;
  RETURN NEW;
END; $function$
;

CREATE OR REPLACE FUNCTION public.bot_registrar_no_cartao(_conversa_id uuid, _texto text, _direcao text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cartao uuid;
BEGIN
  SELECT cartao_id INTO v_cartao FROM public.bot_conversas WHERE id = _conversa_id;
  IF v_cartao IS NULL THEN RETURN; END IF;
  INSERT INTO public.crm_atividades (cartao_id, tipo, corpo)
  VALUES (v_cartao, 'whatsapp',
          CASE WHEN _direcao = 'saida' THEN 'Robo: ' ELSE 'Cliente: ' END || left(COALESCE(_texto,''), 500));
END; $function$
;

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
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_conv.cartao_id IS NOT NULL THEN RETURN v_conv.cartao_id; END IF;

  SELECT escopo, owner_id INTO v_escopo, v_owner FROM public.bot_conexoes WHERE id = v_conv.conexao_id;
  IF v_owner IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_quadro FROM public.crm_quadros
  WHERE escopo = v_escopo AND owner_id = v_owner AND tipo = 'funil' AND arquivado_em IS NULL
  ORDER BY created_at LIMIT 1;
  IF v_quadro IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_cartao FROM public.crm_cartoes
  WHERE quadro_id = v_quadro AND contato_telefone = v_conv.telefone AND arquivado_em IS NULL LIMIT 1;

  IF v_cartao IS NULL THEN
    SELECT id INTO v_coluna FROM public.crm_colunas WHERE quadro_id = v_quadro ORDER BY posicao LIMIT 1;
    IF v_coluna IS NULL THEN RETURN NULL; END IF;
    SELECT COALESCE(MAX(posicao),0) + 1000 INTO v_pos FROM public.crm_cartoes WHERE coluna_id = v_coluna;
    INSERT INTO public.crm_cartoes (quadro_id, coluna_id, posicao, titulo, contato_nome, contato_telefone, origem)
    VALUES (v_quadro, v_coluna, v_pos,
            COALESCE(NULLIF(trim(COALESCE(v_conv.nome,'')), ''), v_conv.telefone),
            v_conv.nome, v_conv.telefone, 'whatsapp')
    RETURNING id INTO v_cartao;
    INSERT INTO public.crm_atividades (cartao_id, tipo, corpo)
    VALUES (v_cartao, 'whatsapp', 'Entrou pelo WhatsApp da academia');
  END IF;

  UPDATE public.bot_conversas SET cartao_id = v_cartao WHERE id = _conversa_id;
  RETURN v_cartao;
END; $function$
;

CREATE OR REPLACE FUNCTION public.crm_acesso_quadro(_quadro_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT CASE q.escopo
      WHEN 'parceiro' THEN public.partner_pode(q.owner_id, 'crm')
      WHEN 'coach' THEN EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = q.owner_id AND pr.user_id = auth.uid())
      WHEN 'profissional' THEN EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = q.owner_id AND pr.user_id = auth.uid())
      WHEN 'admin' THEN COALESCE(public.is_admin(auth.uid()), false)
      ELSE false
    END
    FROM public.crm_quadros q WHERE q.id = _quadro_id
  ), false)
  OR COALESCE(public.is_admin(auth.uid()), false)
$function$
;

CREATE OR REPLACE FUNCTION public.crm_clonar_quadro(_origem_id uuid, _escopo text, _owner_id uuid, _nome text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_novo_id uuid; v_criador uuid; v_pode boolean;
BEGIN
  IF NOT (public.crm_acesso_quadro(_origem_id)
          OR EXISTS (SELECT 1 FROM public.crm_quadros WHERE id = _origem_id AND modelo = true)) THEN
    RAISE EXCEPTION 'Sem acesso ao quadro de origem';
  END IF;
  v_pode := CASE _escopo
    WHEN 'parceiro' THEN public.partner_pode(_owner_id, 'crm')
    WHEN 'coach' THEN EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = _owner_id AND pr.user_id = auth.uid())
    WHEN 'profissional' THEN EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = _owner_id AND pr.user_id = auth.uid())
    WHEN 'admin' THEN COALESCE(public.is_admin(auth.uid()), false)
    ELSE false END;
  IF NOT COALESCE(v_pode, false) THEN RAISE EXCEPTION 'Sem permissao para criar quadro nesse destino'; END IF;
  SELECT pr.id INTO v_criador FROM public.profiles pr WHERE pr.user_id = auth.uid() LIMIT 1;
  INSERT INTO public.crm_quadros (escopo, owner_id, nome, descricao, clonado_de, criado_por)
  SELECT _escopo, _owner_id, COALESCE(_nome, q.nome), q.descricao, q.id, v_criador
  FROM public.crm_quadros q WHERE q.id = _origem_id RETURNING id INTO v_novo_id;
  INSERT INTO public.crm_colunas (quadro_id, nome, posicao, cor, tipo, limite_cartoes)
  SELECT v_novo_id, c.nome, c.posicao, c.cor, c.tipo, c.limite_cartoes
  FROM public.crm_colunas c WHERE c.quadro_id = _origem_id;
  INSERT INTO public.crm_etiquetas (quadro_id, nome, cor)
  SELECT v_novo_id, e.nome, e.cor FROM public.crm_etiquetas e WHERE e.quadro_id = _origem_id;
  RETURN v_novo_id;
END; $function$
;

CREATE OR REPLACE FUNCTION public.crm_criar_quadro(_escopo text, _owner_id uuid, _nome text, _tipo text DEFAULT 'funil'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_criador uuid; v_pode boolean; v_etapas text[]; v_tipos text[]; i int;
BEGIN
  IF _tipo NOT IN ('funil','quadro') THEN RAISE EXCEPTION 'Tipo invalido: %', _tipo; END IF;
  v_pode := CASE _escopo
    WHEN 'parceiro' THEN public.partner_pode(_owner_id, 'crm')
    WHEN 'coach' THEN EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = _owner_id AND pr.user_id = auth.uid())
    WHEN 'profissional' THEN EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = _owner_id AND pr.user_id = auth.uid())
    WHEN 'admin' THEN COALESCE(public.is_admin(auth.uid()), false)
    ELSE false END;
  IF NOT (COALESCE(v_pode,false) OR COALESCE(public.is_admin(auth.uid()),false)) THEN
    RAISE EXCEPTION 'Sem permissao para criar neste destino';
  END IF;
  SELECT pr.id INTO v_criador FROM public.profiles pr WHERE pr.user_id = auth.uid() LIMIT 1;
  INSERT INTO public.crm_quadros (escopo, owner_id, nome, tipo, criado_por)
  VALUES (_escopo, _owner_id, _nome, _tipo, v_criador) RETURNING id INTO v_id;
  IF _tipo = 'funil' THEN
    v_etapas := ARRAY['Novo contato','Contato feito','Aula experimental','Negociando','Matriculado','Perdido'];
    v_tipos := ARRAY['normal','normal','normal','normal','ganho','perdido'];
  ELSE
    v_etapas := ARRAY['A fazer','Fazendo','Feito'];
    v_tipos := ARRAY['normal','normal','ganho'];
  END IF;
  FOR i IN 1 .. array_length(v_etapas,1) LOOP
    INSERT INTO public.crm_colunas (quadro_id, nome, posicao, tipo) VALUES (v_id, v_etapas[i], i*1000, v_tipos[i]);
  END LOOP;
  RETURN v_id;
END; $function$
;

CREATE OR REPLACE FUNCTION public.crm_importar_contatos(_quadro_id uuid, _contatos jsonb, _origem text DEFAULT 'importacao'::text, _coluna_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(criados integer, ignorados integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_coluna uuid; v_pos double precision; v_criados int := 0; v_ignorados int := 0; c jsonb; v_tel text; v_nome text;
BEGIN
  IF NOT public.crm_acesso_quadro(_quadro_id) THEN RAISE EXCEPTION 'Sem acesso a este quadro'; END IF;
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
END; $function$
;

CREATE OR REPLACE FUNCTION public.crm_registrar_mudanca_coluna()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.coluna_id IS DISTINCT FROM OLD.coluna_id THEN
    INSERT INTO public.crm_atividades (cartao_id, tipo, de_coluna_id, para_coluna_id, criado_por)
    VALUES (NEW.id, 'mudanca_coluna', OLD.coluna_id, NEW.coluna_id,
      (SELECT pr.id FROM public.profiles pr WHERE pr.user_id = auth.uid() LIMIT 1));
  END IF;
  RETURN NEW;
END; $function$
;

CREATE OR REPLACE FUNCTION public.crm_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $function$
;

-- -------------------------------------------------- 5. GATILHOS
CREATE TRIGGER trg_bot_conexoes_touch BEFORE UPDATE ON public.bot_conexoes FOR EACH ROW EXECUTE FUNCTION crm_touch_updated_at();
CREATE TRIGGER trg_bot_conversas_touch BEFORE UPDATE ON public.bot_conversas FOR EACH ROW EXECUTE FUNCTION crm_touch_updated_at();
CREATE TRIGGER trg_bot_disparos_touch BEFORE UPDATE ON public.bot_disparos FOR EACH ROW EXECUTE FUNCTION crm_touch_updated_at();
CREATE TRIGGER trg_bot_fluxos_touch BEFORE UPDATE ON public.bot_fluxos FOR EACH ROW EXECUTE FUNCTION crm_touch_updated_at();
CREATE TRIGGER trg_bot_mensagens_relogio AFTER INSERT ON public.bot_mensagens FOR EACH ROW EXECUTE FUNCTION bot_marcar_ultima_mensagem();
CREATE TRIGGER trg_bot_passos_touch BEFORE UPDATE ON public.bot_passos FOR EACH ROW EXECUTE FUNCTION crm_touch_updated_at();
CREATE TRIGGER trg_crm_cartoes_mudanca_coluna AFTER UPDATE ON public.crm_cartoes FOR EACH ROW EXECUTE FUNCTION crm_registrar_mudanca_coluna();
CREATE TRIGGER trg_crm_cartoes_touch BEFORE UPDATE ON public.crm_cartoes FOR EACH ROW EXECUTE FUNCTION crm_touch_updated_at();
CREATE TRIGGER trg_crm_colunas_touch BEFORE UPDATE ON public.crm_colunas FOR EACH ROW EXECUTE FUNCTION crm_touch_updated_at();
CREATE TRIGGER trg_crm_quadros_touch BEFORE UPDATE ON public.crm_quadros FOR EACH ROW EXECUTE FUNCTION crm_touch_updated_at();

-- ---------------------------------------------- 6. SEGURANCA RLS
ALTER TABLE public.bot_conexoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_disparo_alvos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_disparos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_fluxos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_opcoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_passos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_verificacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_atividades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_cartao_etiquetas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_cartoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_colunas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_etiquetas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_quadros ENABLE ROW LEVEL SECURITY;

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
