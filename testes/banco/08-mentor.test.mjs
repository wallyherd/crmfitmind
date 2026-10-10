// N4: privacidade do mentorado (o admin sem opt-in não lê conteúdo) e painel do mentor (migração 004, seção 2).
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { novoBanco, FASE23, FASE4, M004, ler, comoUsuario, comoPapel, tentar, criarUsuario, popularEmpresa } from './pg.mjs';
import { montarCenario, montarLote, empresa, DIA, um, q } from './cenario-fase23.mjs';

const NEGADO = /permission denied/;

// Uma linha de cada tabela de conteúdo para a empresa E (além do que popularEmpresa já criou).
async function conteudo(db, E) {
  const { rows: [cv] } = await db.query(`SELECT contato_id FROM public.bot_conversas WHERE id = $1`, [E.conversaId]);
  let contatoId = cv.contato_id;
  if (!contatoId) {
    contatoId = (await um(db, `INSERT INTO public.contatos (partner_id, telefone, nome) VALUES ($1, '5565911112222', 'Maria') RETURNING id`,
      [E.partnerId])).id;
  }
  await db.query(`INSERT INTO public.wa_contatos_base (conexao_id, jid, telefone, nome) VALUES ($1, '5565933334444@s.whatsapp.net', '5565933334444', 'Base')`, [E.conexaoId]);
  await db.query(`INSERT INTO public.crm_atividades (cartao_id, tipo, corpo) VALUES ($1, 'comentario', 'ligar amanhã')`, [E.cartaoId]);
  const et = await um(db, `INSERT INTO public.crm_etiquetas (quadro_id, nome) VALUES ($1, 'quente') RETURNING id`, [E.quadroId]);
  await db.query(`INSERT INTO public.crm_cartao_etiquetas (cartao_id, etiqueta_id) VALUES ($1, $2)`, [E.cartaoId, et.id]);
  const disp = await um(db, `INSERT INTO public.bot_disparos (escopo, owner_id, nome, mensagem) VALUES ('parceiro', $1, 'Campanha', 'Oi') RETURNING id`, [E.partnerId]);
  await db.query(`INSERT INTO public.bot_disparo_alvos (disparo_id, telefone, nome) VALUES ($1, '5565955556666', 'Alvo')`, [disp.id]);
  await db.query(`INSERT INTO public.vendas (partner_id, contato_id, dia, valor, fonte) VALUES ($1, $2, current_date, 100, 'manual')`, [E.partnerId, contatoId]);
  await db.query(`INSERT INTO public.tarefas_followup (partner_id, contato_id, tipo, vence_em, origem) VALUES ($1, $2, 'followup', now(), 'manual')`, [E.partnerId, contatoId]);
  const l = await um(db, `INSERT INTO public.ia_lotes (partner_id, dia, fuso, arquivo_path, marca_em) VALUES ($1, current_date - 1, 'America/Cuiaba', 'x/lote.txt', now()) RETURNING id`, [E.partnerId]);
  const a = await um(db, `INSERT INTO public.ia_analises (lote_id, partner_id, dia, engine_tipo, idem_chave, payload, principal)
                          VALUES ($1, $2, current_date - 1, 'manual', $3, '{}', 'usuario:teste') RETURNING id`, [l.id, E.partnerId, `k-${l.id}`]);
  await db.query(`INSERT INTO public.ia_sugestoes (partner_id, contato_id, analise_id, tipo, conteudo) VALUES ($1, $2, $3, 'mensagem', 'Oi Maria')`, [E.partnerId, contatoId, a.id]);
  await db.query(`INSERT INTO public.ia_feedback (partner_id, contato_id, alvo, acao) VALUES ($1, $2, 'categoria', 'corrigiu')`, [E.partnerId, contatoId]);
  await db.query(`UPDATE public.ia_relatorios_diarios SET leads_analisados = '[{"nome": "Maria"}]', resumo_executivo = 'Dia bom' WHERE partner_id = $1`, [E.partnerId]);
}

const TABELAS_CONTEUDO = {
  bot_conversas: `SELECT c.id FROM public.bot_conversas c JOIN public.bot_conexoes x ON x.id = c.conexao_id WHERE x.owner_id = $1`,
  bot_mensagens: `SELECT m.id FROM public.bot_mensagens m JOIN public.bot_conversas c ON c.id = m.conversa_id JOIN public.bot_conexoes x ON x.id = c.conexao_id WHERE x.owner_id = $1`,
  wa_contatos_base: `SELECT w.jid FROM public.wa_contatos_base w JOIN public.bot_conexoes x ON x.id = w.conexao_id WHERE x.owner_id = $1`,
  bot_disparo_alvos: `SELECT a.id FROM public.bot_disparo_alvos a JOIN public.bot_disparos d ON d.id = a.disparo_id WHERE d.owner_id = $1`,
  crm_cartoes: `SELECT c.id FROM public.crm_cartoes c JOIN public.crm_quadros q ON q.id = c.quadro_id WHERE q.owner_id = $1`,
  crm_atividades: `SELECT a.id FROM public.crm_atividades a JOIN public.crm_cartoes c ON c.id = a.cartao_id JOIN public.crm_quadros q ON q.id = c.quadro_id WHERE q.owner_id = $1`,
  crm_cartao_etiquetas: `SELECT e.cartao_id FROM public.crm_cartao_etiquetas e JOIN public.crm_cartoes c ON c.id = e.cartao_id JOIN public.crm_quadros q ON q.id = c.quadro_id WHERE q.owner_id = $1`,
  ...Object.fromEntries(['contatos', 'vendas', 'tarefas_followup', 'ia_lotes', 'ia_analises', 'ia_sugestoes', 'ia_feedback']
    .map((t) => [t, `SELECT id FROM public.${t} WHERE partner_id = $1`])),
};

const contar = (db, uid, E) => comoUsuario(db, uid, async () => {
  const r = {};
  for (const [t, sql] of Object.entries(TABELAS_CONTEUDO)) r[t] = (await db.query(sql, [E.partnerId])).rows.length;
  return r;
});
const nenhuma = (r) => Object.entries(r).filter(([, n]) => n !== 0);
const vazias = (r) => Object.entries(r).filter(([, n]) => n === 0);

describe('004 (N4): o admin sem opt-in não lê conteúdo', () => {
  let db, A, admin, membroRobo;
  const definir = (profileId, valor) =>
    comoPapel(db, 'service_role', null, () => tentar(db, `SELECT public.empresa_definir_privacidade($1, $2, $3) AS r`, [A.partnerId, profileId, valor]));

  before(async () => {
    db = await novoBanco({ extras: FASE4 });
    A = await popularEmpresa(db, await criarUsuario(db, { email: 'a@mentoria.test', empresa: 'Empresa A' }), '5565900000001');
    await conteudo(db, A);
    admin = await criarUsuario(db, { email: 'mentor@mentoria.test', admin: true });
    membroRobo = await criarUsuario(db, { email: 'robo@mentoria.test' });
    await db.query(`INSERT INTO public.partner_members (partner_id, profile_id, papel, permissoes) VALUES ($1, $2, 'membro', '{robo}')`,
      [A.partnerId, membroRobo.profileId]);
  });

  test('o dono lê todas as tabelas de conteúdo (o teste tem linha em cada uma)', async () => {
    assert.deepEqual(vazias(await contar(db, A.uid, A)), []);
  });

  test('empresa nasce sem opt-in', async () => {
    const c = await um(db, `SELECT mentor_pode_ver_conversas, mentor_pode_ver_conversas_em FROM public.partner_acesso_config WHERE partner_id = $1`, [A.partnerId]);
    assert.equal(c.mentor_pode_ver_conversas, false);
    assert.equal(c.mentor_pode_ver_conversas_em, null);
  });

  test('admin sem opt-in: nenhuma linha de conteúdo, nem gravando', async () => {
    assert.deepEqual(nenhuma(await contar(db, admin.uid, A)), []);
    await comoUsuario(db, admin.uid, async () => {
      const r = await tentar(db, `INSERT INTO public.crm_cartoes (quadro_id, coluna_id, titulo) VALUES ($1, $2, 'do mentor')`, [A.quadroId, A.colunaId]);
      assert.match(r.erro || '', /row-level security/);
      const u = await tentar(db, `UPDATE public.crm_cartoes SET titulo = 'x' WHERE id = $1 RETURNING id`, [A.cartaoId]);
      assert.equal(u.linhas?.length, 0);
    });
  });

  test('admin sem opt-in: nem pelas funções', async () => {
    await comoUsuario(db, admin.uid, async () => {
      assert.match((await tentar(db, `SELECT * FROM public.crm_pendencias($1)`, [A.partnerId])).erro || '', NEGADO);
      assert.match((await tentar(db, `SELECT * FROM public.crm_importar_contatos($1, '[{"telefone": "5565900000001"}]')`, [A.quadroId])).erro || '', /Sem acesso/);
      assert.match((await tentar(db, `SELECT leads_analisados FROM public.ia_relatorios_diarios`)).erro || '', NEGADO);
      for (const sql of [`SELECT * FROM public.mentor_painel()`, `SELECT public.empresa_definir_privacidade($1, $2, true)`]) {
        assert.match((await tentar(db, sql, sql.includes('$1') ? [A.partnerId, admin.profileId] : [])).erro || '', NEGADO, sql);
      }
      const v = await tentar(db, `SELECT public.pode_ver_conteudo($1) AS a, public.pode_ver_conteudo($1, 'robo') AS b`, [A.partnerId]);
      assert.deepEqual(v.linhas[0], { a: false, b: false });
    });
  });

  test('admin sem opt-in continua vendo empresa, conexão, números e resumo do dia', async () => {
    await comoUsuario(db, admin.uid, async () => {
      assert.equal((await q(db, `SELECT id FROM public.partners WHERE id = $1`, [A.partnerId])).length, 1);
      assert.equal((await q(db, `SELECT id, status, visto_em FROM public.bot_conexoes WHERE id = $1`, [A.conexaoId])).length, 1);
      const rel = await q(db, `SELECT id, resumo_executivo, metricas FROM public.ia_relatorios_diarios WHERE partner_id = $1`, [A.partnerId]);
      assert.equal(rel[0].resumo_executivo, 'Dia bom');
      const m = await um(db, `SELECT public.crm_metricas_dia($1, current_date) AS r`, [A.partnerId]);
      assert.equal(typeof m.r.novas, 'number');
      assert.equal((await q(db, `SELECT id FROM public.crm_quadros WHERE id = $1`, [A.quadroId])).length, 1);
    });
  });

  test('membro só com robo lê a conversa mas não o funil', async () => {
    const r = await contar(db, membroRobo.uid, A);
    assert.equal(r.bot_mensagens, 1);
    assert.equal(r.crm_cartoes, 0);
    assert.equal(r.contatos, 0);
  });

  test('mentorado não muda o opt-in: nem pelo navegador, nem membro, nem admin', async () => {
    await comoUsuario(db, A.uid, async () => {
      assert.match((await tentar(db, `SELECT public.empresa_definir_privacidade($1, $2, true)`, [A.partnerId, A.profileId])).erro || '', NEGADO);
      assert.match((await tentar(db, `UPDATE public.partner_acesso_config SET mentor_pode_ver_conversas = true`)).erro || '', NEGADO);
    });
    await comoUsuario(db, admin.uid, async () => {
      assert.match((await tentar(db, `UPDATE public.partner_acesso_config SET mentor_pode_ver_conversas = true`)).erro || '', NEGADO);
    });
    assert.match((await definir(membroRobo.profileId, true)).erro || '', /so_o_dono/);
    assert.match((await definir(admin.profileId, true)).erro || '', /so_o_dono/);
    assert.match((await definir(A.profileId, null)).erro || '', /valor invalido/);
    const c = await um(db, `SELECT mentor_pode_ver_conversas FROM public.partner_acesso_config WHERE partner_id = $1`, [A.partnerId]);
    assert.equal(c.mentor_pode_ver_conversas, false);
  });

  test('com o opt-in do dono, o admin lê; desligado, deixa de ler', async () => {
    const r = await definir(A.profileId, true);
    assert.equal(r.linhas[0].r.mentor_pode_ver_conversas, true);
    assert.ok(r.linhas[0].r.mentor_pode_ver_conversas_em);
    assert.deepEqual(vazias(await contar(db, admin.uid, A)), []);
    await comoUsuario(db, admin.uid, async () => {
      // leads_analisados segue fora do navegador para todos: o relatório vem pela rota
      assert.match((await tentar(db, `SELECT leads_analisados FROM public.ia_relatorios_diarios`)).erro || '', NEGADO);
      assert.equal((await tentar(db, `SELECT * FROM public.crm_importar_contatos($1, '[{"nome": "Novo"}]')`, [A.quadroId])).linhas[0].criados, 1);
    });
    await definir(A.profileId, false);
    assert.deepEqual(nenhuma(await contar(db, admin.uid, A)), []);
  });

  test('dono com acesso vencido desliga, mas não liga', async () => {
    await db.query(`UPDATE public.profiles SET expira_em = now() - interval '1 day' WHERE id = $1`, [A.profileId]);
    try {
      assert.match((await definir(A.profileId, true)).erro || '', /so_o_dono/);
      assert.equal((await definir(A.profileId, false)).linhas[0].r.mentor_pode_ver_conversas, false);
    } finally {
      await db.query(`UPDATE public.profiles SET expira_em = NULL WHERE id = $1`, [A.profileId]);
    }
  });

  test('o acesso a estrutura e a outra empresa não mudou', async () => {
    const B = await popularEmpresa(db, await criarUsuario(db, { email: 'b@mentoria.test', empresa: 'Empresa B' }), '5565900000002');
    assert.deepEqual(nenhuma(await contar(db, B.uid, A)), []);
    await comoUsuario(db, B.uid, async () => {
      assert.equal((await q(db, `SELECT id FROM public.bot_conexoes WHERE id = $1`, [A.conexaoId])).length, 0);
      assert.equal((await q(db, `SELECT id FROM public.ia_relatorios_diarios WHERE partner_id = $1`, [A.partnerId])).length, 0);
    });
  });
});

describe('004 (N4): mentor_painel', () => {
  let db, c, outra;
  const painel = (dia) => comoPapel(db, 'service_role', null, () => q(db, `SELECT * FROM public.mentor_painel($1)`, [dia ?? null]));

  before(async () => {
    db = await novoBanco({ extras: FASE4 });
    c = await montarCenario(db);
    outra = await empresa(db, 'bia@mentoria.test', 'Bia Vendas');
    const inativa = await criarUsuario(db, { email: 'parada@mentoria.test', empresa: 'Parada' });
    await db.query(`UPDATE public.partners SET status = 'inativo' WHERE id = $1`, [inativa.partnerId]);
  });

  test('uma linha por empresa ativa; números iguais a crm_metricas_dia, empresa por empresa', async () => {
    const linhas = await painel(DIA);
    assert.deepEqual(linhas.map((l) => l.empresa), ['Bia Vendas', 'Mentoria da Ana']);
    for (const l of linhas) {
      const m = (await um(db, `SELECT public.crm_metricas_dia($1, $2) AS r`, [l.partner_id, DIA])).r;
      assert.deepEqual(l.numeros, {
        medido_em: m.medido_em, novas: m.novas, trafego_pago: m.trafego_pago.total,
        esperando_voce: m.esperando_voce, cliente_sumiu: m.cliente_sumiu,
        resposta_mediana_min: m.resposta.mediana_min, resposta_p90_min: m.resposta.p90_min,
        followups_vencidos: m.followups.vencidos,
        vendas_confirmado_qtd: m.vendas.confirmado_qtd, vendas_confirmado_valor: m.vendas.confirmado_valor,
        vendas_a_confirmar_qtd: m.vendas.a_confirmar_qtd, vendas_a_confirmar_valor: m.vendas.a_confirmar_valor,
        conversao_dia_pct: m.conversao.dia_pct, conversao_coorte7d_pct: m.conversao.coorte7d_pct,
      }, l.empresa);
      assert.deepEqual(l.metas, m.metas, l.empresa);
      assert.equal(l.dia.toISOString().slice(0, 10), DIA);
      assert.equal(l.opt_in, false);
    }
    const ana = linhas.find((l) => l.partner_id === c.p);
    assert.equal(ana.numeros.novas, 5);
    assert.ok(ana.metas.length > 0);
    assert.equal(ana.mentorado, 'ana@mentoria.test');
  });

  test('nada de conteúdo na saída: sem telefone, nome de contato nem texto de mensagem', async () => {
    const texto = JSON.stringify(await painel(DIA));
    assert.doesNotMatch(texto, /\d{10,}/);
    const nomes = (await q(db, `SELECT nome FROM public.contatos WHERE partner_id = $1 AND nome IS NOT NULL`, [c.p])).map((r) => r.nome);
    assert.ok(nomes.length > 0);
    for (const n of nomes) assert.ok(!texto.includes(n), `vazou o nome ${n}`);
    const corpos = (await q(db, `SELECT corpo FROM public.bot_mensagens WHERE corpo IS NOT NULL AND length(corpo) > 12 LIMIT 20`)).map((r) => r.corpo);
    for (const t of corpos) assert.ok(!texto.includes(t), `vazou a mensagem ${t}`);
  });

  test('conexões, lote da véspera e alertas', async () => {
    await montarLote(db, c.p, DIA);
    const diaSeguinte = new Date(Date.parse(DIA) + 864e5).toISOString().slice(0, 10);
    await db.query(`UPDATE public.bot_conexoes SET status = 'conectado', visto_em = now() - interval '25 minutes' WHERE id = $1`, [c.emp.conexaoId]);
    await db.query(`UPDATE public.bot_conexoes SET status = 'conectado', visto_em = now() WHERE id = $1`, [outra.conexaoId]);
    await db.query(`UPDATE public.profiles SET expira_em = now() + interval '3 days' WHERE id = $1`, [outra.profileId]);
    for (let i = 0; i < 6; i++) {
      await db.query(`INSERT INTO public.vendas (partner_id, dia, valor, fonte) VALUES ($1, $2, 10, 'manual')`, [outra.partnerId, DIA]);
    }
    const linhas = await painel(diaSeguinte);
    const ana = linhas.find((l) => l.partner_id === c.p);
    const bia = linhas.find((l) => l.partner_id === outra.partnerId);

    assert.equal(ana.conexoes.length, 1);
    assert.equal(ana.conexoes[0].status, 'conectado');
    assert.ok(ana.conexoes[0].minutos_sem_sinal >= 24);
    assert.ok(!('numero' in ana.conexoes[0]));
    assert.equal(ana.relatorio.dia, DIA);
    assert.equal(ana.relatorio.lote, 'pronto');
    assert.equal(ana.relatorio.analise, null);
    assert.ok(ana.ultima_atividade);
    // dia passado: já passou das 08:00 e a análise da véspera não veio
    assert.deepEqual(ana.alertas.sort(), ['analise_atrasada', 'conexao_sem_sinal']);

    assert.equal(bia.vendas_a_confirmar, 6);
    assert.equal(bia.relatorio.lote, null);
    assert.deepEqual(bia.alertas.sort(), ['acesso_vencendo', 'analise_atrasada', 'sem_conversa_2_dias', 'vendas_a_confirmar']);

    await db.query(`UPDATE public.ia_lotes SET status = 'erro' WHERE partner_id = $1 AND dia = $2`, [c.p, DIA]);
    const comErro = (await painel(diaSeguinte)).find((l) => l.partner_id === c.p);
    assert.equal(comErro.relatorio.lote, 'erro');
    assert.ok(comErro.alertas.includes('analise_com_erro'));
    assert.ok(!comErro.alertas.includes('analise_atrasada'));
  });

  test('opt-in aparece no painel', async () => {
    await comoPapel(db, 'service_role', null, () =>
      db.query(`SELECT public.empresa_definir_privacidade($1, $2, true)`, [c.p, c.emp.profileId]));
    const ana = (await painel(DIA)).find((l) => l.partner_id === c.p);
    assert.equal(ana.opt_in, true);
  });

  test('só o servidor executa', async () => {
    for (const papel of ['authenticated', 'anon']) {
      await comoPapel(db, papel, papel === 'anon' ? null : c.emp.uid, async () => {
        assert.match((await tentar(db, `SELECT * FROM public.mentor_painel()`)).erro || '', NEGADO, papel);
      });
    }
  });
});

describe('004 (N4): roda duas vezes', () => {
  test('sobre a 003 e de novo sobre ela mesma, sem erro e com o mesmo resultado', async () => {
    const db = await novoBanco({ extras: FASE23 });
    const A = await popularEmpresa(db, await criarUsuario(db, { email: 'a@mentoria.test', empresa: 'A' }), '5565900000001');
    await conteudo(db, A);
    const admin = await criarUsuario(db, { email: 'mentor@mentoria.test', admin: true });
    // antes da 004 o admin lia tudo (achado R5)
    assert.deepEqual(vazias(await contar(db, admin.uid, A)), []);
    await db.exec(ler(M004));
    await db.exec(ler(M004));
    assert.deepEqual(nenhuma(await contar(db, admin.uid, A)), []);
    assert.deepEqual(vazias(await contar(db, A.uid, A)), []);
    const pol = await q(db, `SELECT tablename, count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'
                              AND tablename IN ('bot_mensagens', 'crm_cartoes', 'contatos') GROUP BY 1 ORDER BY 1`);
    assert.deepEqual(pol, [{ tablename: 'bot_mensagens', n: 1 }, { tablename: 'contatos', n: 1 }, { tablename: 'crm_cartoes', n: 1 }]);
  });
});
