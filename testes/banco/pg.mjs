// Sobe um Postgres embutido com o mínimo do Supabase e o esquema base do CRM.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const aqui = path.dirname(fileURLToPath(import.meta.url));
export const raiz = path.resolve(aqui, '..', '..');
export const ler = (rel) => readFileSync(path.resolve(raiz, rel), 'utf8');

// Arquivos do esquema base, na ordem em que um banco novo é instalado.
export const BASE = ['banco-instalar-completo.sql', 'banco-retroalimentacao.sql'];
// Migrações para banco que já existe, em ordem.
export const MIGRACOES = ['banco/migracoes/001-fase0-seguranca.sql'];
// Fase 1 (captura): roda depois da 001.
export const M002 = 'banco/migracoes/002-fase1-captura.sql';
export const FASE1 = [...MIGRACOES, M002];
// Fases 2 e 3 (dados e IA): roda depois da 002.
export const M003 = 'banco/migracoes/003-dados-e-ia.sql';
export const FASE23 = [...FASE1, M003];
// Ajustes da mentoria: roda depois da 003.
export const M004 = 'banco/migracoes/004-ajustes-mentoria.sql';
export const FASE4 = [...FASE23, M004];
// Achados da revisão N7: roda depois da 004.
export const M005 = 'banco/migracoes/005-achados-revisao.sql';
export const FASE5 = [...FASE4, M005];
// Comprovantes (tarefa Q1): roda depois da 005.
export const M006 = 'banco/migracoes/006-comprovantes.sql';
export const FASE6 = [...FASE5, M006];

export async function novoBanco({ base = BASE, extras = [] } = {}) {
  const db = new PGlite();
  await db.exec(ler('testes/banco/00-stub-supabase.sql'));
  for (const f of [...base, ...extras]) {
    try { await db.exec(ler(f)); }
    catch (e) { e.message = `${f}: ${e.message}`; throw e; }
  }
  return db;
}

// Executa com um papel do Supabase ('authenticated', 'anon', 'service_role')
// e, opcionalmente, um usuário logado (auth.uid()).
export async function comoPapel(db, papel, uid, fn) {
  await db.exec(`SET test.uid = '${uid || ''}'; SET ROLE ${papel};`);
  try { return await fn(); } finally { await db.exec(`RESET ROLE; SET test.uid = '';`); }
}

// Executa como um usuário logado (auth.uid()) e papel authenticated.
export async function comoUsuario(db, uid, fn) {
  return comoPapel(db, 'authenticated', uid, fn);
}

// Resultado de uma consulta, ou o erro do Postgres como texto (para conferir permissão negada).
export async function tentar(db, sql, params) {
  try { return { linhas: (await db.query(sql, params)).rows }; }
  catch (e) { return { erro: e.message }; }
}

// Cria um usuário do Auth (o gatilho faz o profile), ativa e, se pedido, dá uma empresa completa.
export async function criarUsuario(db, { email, admin = false, empresa = null, status = 'ativo', expiraEm = null }) {
  const { rows: [u] } = await db.query(
    `INSERT INTO auth.users (email, raw_user_meta_data) VALUES ($1, jsonb_build_object('name', $1::text)) RETURNING id`, [email]);
  await db.query(`UPDATE public.profiles SET status = $2, role = $3, expira_em = $4 WHERE user_id = $1`,
    [u.id, status, admin ? 'admin' : 'user', expiraEm]);
  const { rows: [p] } = await db.query(`SELECT id FROM public.profiles WHERE user_id = $1`, [u.id]);
  const r = { uid: u.id, profileId: p.id };
  if (empresa) {
    const { rows: [b] } = await db.query(`SELECT public.bootstrap_empresa_completa($1, $2) AS j`, [u.id, empresa]);
    Object.assign(r, { partnerId: b.j.partner_id, quadroId: b.j.quadro_id, fluxoId: b.j.fluxo_id });
  }
  return r;
}

// Uma conexão com conversa, mensagem, cartão e relatório para a empresa.
export async function popularEmpresa(db, emp, tel) {
  const { rows: [c] } = await db.query(
    `INSERT INTO public.bot_conexoes (escopo, owner_id, nome) VALUES ('parceiro', $1, 'Numero') RETURNING id`, [emp.partnerId]);
  const { rows: [cv] } = await db.query(
    `INSERT INTO public.bot_conversas (conexao_id, telefone) VALUES ($1, $2) RETURNING id`, [c.id, tel]);
  await db.query(`INSERT INTO public.bot_mensagens (conversa_id, direcao, corpo) VALUES ($1, 'entrada', 'oi')`, [cv.id]);
  const { rows: [col] } = await db.query(
    `SELECT id FROM public.crm_colunas WHERE quadro_id = $1 ORDER BY posicao LIMIT 1`, [emp.quadroId]);
  const { rows: [cart] } = await db.query(
    `INSERT INTO public.crm_cartoes (quadro_id, coluna_id, titulo, contato_telefone) VALUES ($1, $2, 'Lead', $3) RETURNING id`,
    [emp.quadroId, col.id, tel]);
  await db.query(
    `INSERT INTO public.ia_relatorios_diarios (partner_id, data_referencia) VALUES ($1, current_date)`, [emp.partnerId]);
  return { ...emp, conexaoId: c.id, conversaId: cv.id, cartaoId: cart.id, colunaId: col.id };
}
