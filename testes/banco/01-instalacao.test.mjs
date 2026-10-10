// O instalador (banco-instalar-completo.sql + banco-retroalimentacao.sql) num banco vazio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { novoBanco, ler, criarUsuario } from './pg.mjs';

const colunas = async (db, tabela) =>
  (await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [tabela],
  )).rows.map((r) => r.column_name);

test('instala do zero num banco novo', async () => {
  const db = await novoBanco();
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
  assert.equal(rows[0].n, 23);
});

test('profiles tem as colunas que o servidor usa e nenhuma de senha', async () => {
  const db = await novoBanco();
  const cols = await colunas(db, 'profiles');
  for (const c of ['id', 'user_id', 'name', 'email', 'phone', 'role', 'status', 'expira_em', 'partner_id']) {
    assert.ok(cols.includes(c), `falta profiles.${c}`);
  }
  assert.ok(!cols.some((c) => /senha|password/i.test(c)), `coluna de senha: ${cols}`);
  for (const f of ['banco-instalar-completo.sql', 'banco-retroalimentacao.sql']) {
    assert.ok(!/senha_hash/i.test(ler(f)), `${f} ainda fala de senha_hash`);
  }
});

test('gatilho de auth.users cria o profile suspenso', async () => {
  const db = await novoBanco();
  const { rows: [u] } = await db.query(
    `INSERT INTO auth.users (email, raw_user_meta_data) VALUES ('novo@x.com', '{"name":"Novo"}') RETURNING id`);
  const { rows: [p] } = await db.query(`SELECT email, name, role, status FROM public.profiles WHERE user_id = $1`, [u.id]);
  assert.deepEqual(p, { email: 'novo@x.com', name: 'Novo', role: 'user', status: 'suspenso' });
});

test('bootstrap_empresa_completa usa o profile do usuário e nunca cria admin', async () => {
  const db = await novoBanco();
  const dono = await criarUsuario(db, { email: 'dono@x.com', empresa: 'Loja do Dono' });

  const { rows: [pr] } = await db.query(`SELECT count(*)::int AS n FROM public.profiles`);
  assert.equal(pr.n, 1, 'não pode criar um segundo profile para o mesmo usuário');
  const { rows: [m] } = await db.query(
    `SELECT papel, permissoes FROM public.partner_members WHERE partner_id = $1 AND profile_id = $2`, [dono.partnerId, dono.profileId]);
  assert.deepEqual(m, { papel: 'owner', permissoes: ['robo', 'crm'] });

  const { rows: cols } = await db.query(
    `SELECT nome, tipo FROM public.crm_colunas WHERE quadro_id = $1 ORDER BY posicao`, [dono.quadroId]);
  assert.equal(cols.length, 6);
  assert.deepEqual(cols.filter((c) => c.tipo !== 'normal').map((c) => c.tipo), ['ganho', 'perdido']);

  const { rows: [passo] } = await db.query(
    `SELECT conteudo FROM public.bot_passos WHERE fluxo_id = $1 AND chave = 'inicio'`, [dono.fluxoId]);
  assert.ok(passo.conteudo.includes('\n'), 'quebra de linha de verdade, não "\\n" literal');

  // Sem usuário: profile sem login, papel 'user'.
  const { rows: [b] } = await db.query(`SELECT public.bootstrap_empresa_completa(NULL, 'Sem Dono') AS j`);
  const { rows: [orfao] } = await db.query(`SELECT role, user_id FROM public.profiles WHERE id = $1`, [b.j.profile_id]);
  assert.deepEqual(orfao, { role: 'user', user_id: null });
  const { rows: [admins] } = await db.query(`SELECT count(*)::int AS n FROM public.profiles WHERE role = 'admin'`);
  assert.equal(admins.n, 0);
});
