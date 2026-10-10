-- O que o diagnóstico de 09/10 achou além dos 2 admins: uma empresa-semente (1 empresa, 1 membro, 1 funil,
-- 0 conexões, 0 conversas, 0 cartões) cujo dono é um profile de admin SEM login (user_id nulo) — o terceiro dos
-- "3 profiles sem user_id". É o que bootstrap_empresa_completa(NULL, ...) deixava (a função antiga criava o dono
-- como role = 'admin'). Escrito com INSERT direto porque crm_criar_quadro exige um usuário logado.
WITH dono AS (
  INSERT INTO public.profiles (name, role) VALUES ('Empresa Semente', 'admin') RETURNING id
), emp AS (
  INSERT INTO public.partners (profile_id, fantasy_name, city, state, status)
  SELECT id, 'Empresa Semente', 'Cuiaba', 'MT', 'ativo' FROM dono RETURNING id, profile_id
), mem AS (
  INSERT INTO public.partner_members (partner_id, profile_id, papel, permissoes)
  SELECT id, profile_id, 'owner', ARRAY['robo', 'crm'] FROM emp
), cfg AS (
  INSERT INTO public.partner_acesso_config (partner_id, timezone) SELECT id, 'America/Sao_Paulo' FROM emp
), q AS (
  INSERT INTO public.crm_quadros (escopo, owner_id, nome, tipo) SELECT 'parceiro', id, 'Funil de Vendas', 'funil' FROM emp RETURNING id
), col AS (
  INSERT INTO public.crm_colunas (quadro_id, nome, posicao, tipo)
  SELECT q.id, v.nome, v.pos, v.tipo
    FROM q, (VALUES ('Novo contato', 1000, 'normal'), ('Contato feito', 2000, 'normal'), ('Aula experimental', 3000, 'normal'),
                    ('Negociando', 4000, 'normal'), ('Matriculado', 5000, 'ganho'), ('Perdido', 6000, 'perdido')) AS v(nome, pos, tipo)
)
INSERT INTO public.bot_fluxos (escopo, owner_id, nome, ativo, gatilho_tipo)
SELECT 'parceiro', id, 'Atendimento Geral', true, 'primeira_mensagem' FROM emp;
