// N1: fuso padrão Cuiabá-MT (migração 004, seção 1).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { novoBanco, FASE23, FASE4, M004, ler, criarUsuario } from './pg.mjs';

const um = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const fuso = (db, id) => um(db, `SELECT timezone FROM public.partner_acesso_config WHERE partner_id = $1`, [id]).then((r) => r.timezone);

describe('004 (N1): fuso Cuiabá', () => {
  test('empresa nova nasce com Cuiabá e a virada do dia acompanha', async () => {
    const db = await novoBanco({ extras: FASE4 });
    const u = await criarUsuario(db, { email: 'cuiaba@mentoria.test', empresa: 'Cuiabá' });
    assert.equal(await fuso(db, u.partnerId), 'America/Cuiaba');
    const d = await um(db, `SELECT column_default FROM information_schema.columns WHERE table_name = 'partner_acesso_config' AND column_name = 'timezone'`);
    assert.match(d.column_default, /America\/Cuiaba/);
    // 02:00 UTC = 22:00 do dia anterior em Cuiabá (UTC-4) e 23:00 em São Paulo.
    const r = await um(db, `SELECT ('2026-03-10 02:00+00'::timestamptz AT TIME ZONE $1)::date AS d`, [await fuso(db, u.partnerId)]);
    assert.equal(r.d.toISOString().slice(0, 10), '2026-03-09');
  });

  test('a 004 converte São Paulo em Cuiabá, preserva outros fusos e é idempotente', async () => {
    const db = await novoBanco({ extras: FASE23 });
    const a = await criarUsuario(db, { email: 'a@mentoria.test', empresa: 'A' });
    const b = await criarUsuario(db, { email: 'b@mentoria.test', empresa: 'B' });
    await db.query(`UPDATE public.partner_acesso_config SET timezone = 'America/Sao_Paulo' WHERE partner_id = $1`, [a.partnerId]);
    await db.query(`UPDATE public.partner_acesso_config SET timezone = 'America/Manaus' WHERE partner_id = $1`, [b.partnerId]);
    await db.exec(ler(M004));
    await db.exec(ler(M004));
    assert.equal(await fuso(db, a.partnerId), 'America/Cuiaba');
    assert.equal(await fuso(db, b.partnerId), 'America/Manaus');
  });

  test('achado 14: rodar a 004 de novo não desfaz um São Paulo escolhido depois', async () => {
    const db = await novoBanco({ extras: FASE23 });
    const a = await criarUsuario(db, { email: 'sp@mentoria.test', empresa: 'SP' });
    await db.exec(ler(M004));
    await db.query(`UPDATE public.partner_acesso_config SET timezone = 'America/Sao_Paulo' WHERE partner_id = $1`, [a.partnerId]);
    await db.exec(ler(M004));
    assert.equal(await fuso(db, a.partnerId), 'America/Sao_Paulo');
  });

  test('bootstrap das migrações 001/003 já grava Cuiabá, sem a 004', async () => {
    const db = await novoBanco({ extras: FASE23 });
    const u = await criarUsuario(db, { email: 'c@mentoria.test', empresa: 'C' });
    assert.equal(await fuso(db, u.partnerId), 'America/Cuiaba');
  });
});
