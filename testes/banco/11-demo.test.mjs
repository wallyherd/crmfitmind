// P1: dados de demonstração (banco/demo). Base + 001 a 005, mentorado de teste criado como a tela cria,
// demo-criar, conferência dos números e das telas, demo-remover e prova de que o resto ficou intacto.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { novoBanco, FASE5, ler, raiz, comoPapel, criarUsuario, popularEmpresa } from './pg.mjs';

const CRIAR = ler('banco/demo/demo-criar.sql');
const REMOVER = ler('banco/demo/demo-remover.sql');
const EMAIL = 'mentorado.demo@mentoria.test';
const PLACEHOLDER = 'TROQUE-PELO-EMAIL-DO-MENTORADO-DE-TESTE';
const com = (sql, email) => sql.replace(PLACEHOLDER, email);
const q = async (db, sql, params) => (await db.query(sql, params)).rows;
const um = async (db, sql, params) => (await q(db, sql, params))[0];

// Foto do banco inteiro (tabelas do esquema public): contagem e hash de cada tabela.
async function foto(db) {
  const out = {};
  const tabelas = await q(db, `SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                                WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`);
  for (const { relname } of tabelas) {
    const r = await um(db, `SELECT count(*)::int AS n, COALESCE(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM public.${relname} t`);
    out[relname] = r;
  }
  return out;
}

describe('P1: dados de demonstração', () => {
  let db, mentee, outra, antes, hoje, ontem, admin;

  before(async () => {
    db = await novoBanco({ extras: FASE5 });
    admin = await criarUsuario(db, { email: 'admin@mentoria.test', admin: true });
    outra = await popularEmpresa(db, await criarUsuario(db, { email: 'real@mentoria.test', empresa: 'Empresa Real' }), '5565900000001');
    mentee = await criarUsuario(db, { email: EMAIL, empresa: 'Empresa de Teste' });
    antes = await foto(db);
    const d = await um(db, `SELECT (now() AT TIME ZONE 'America/Cuiaba')::date AS hoje,
                                    EXTRACT(epoch FROM now() - (date_trunc('day', now() AT TIME ZONE 'America/Cuiaba') AT TIME ZONE 'America/Cuiaba')) / 60 AS min_desde_meia_noite`);
    hoje = d.hoje; ontem = new Date(new Date(d.hoje).getTime() - 864e5).toISOString().slice(0, 10);
    hoje = new Date(d.hoje).toISOString().slice(0, 10);
    antes.__min = Number(d.min_desde_meia_noite);
  });

  test('recusa e-mail que não existe, conta de admin e a marca de exemplo sem trocar', async () => {
    await assert.rejects(db.exec(CRIAR), /não existe usuário com o e-mail "TROQUE-PELO-EMAIL/);
    await assert.rejects(db.exec(com(CRIAR, 'nao.existe@mentoria.test')), /não existe usuário/);
    await assert.rejects(db.exec(com(CRIAR, 'admin@mentoria.test')), /conta de admin/);
    await assert.rejects(db.exec(com(REMOVER, EMAIL)), /não tem dados de demonstração/);
  });

  test('recusa empresa que já tem dado real, sem sujar nada', async () => {
    await assert.rejects(db.exec(com(CRIAR, 'real@mentoria.test')), /já tem conexões/);
    assert.deepEqual(await foto(db), (({ __min, ...r }) => r)(antes));
  });

  test('demo-criar roda e mostra o resumo', async () => {
    await db.exec(com(CRIAR, EMAIL));
  });

  test('recusa rodar duas vezes na mesma empresa, com mensagem clara, e não duplica', async () => {
    const n = (await um(db, `SELECT count(*)::int AS n FROM public.bot_mensagens`)).n;
    await assert.rejects(db.exec(com(CRIAR, EMAIL)), /já tem os dados de demonstração.*demo-remover\.sql/);
    assert.equal((await um(db, `SELECT count(*)::int AS n FROM public.bot_mensagens`)).n, n);
  });

  test('conexão gateway conectada, catálogo, rastreio e metas', async () => {
    const cx = await q(db, `SELECT nome, modo, status, bot_ativo FROM public.bot_conexoes WHERE owner_id = $1`, [mentee.partnerId]);
    assert.deepEqual(cx, [{ nome: 'DEMO WhatsApp de teste', modo: 'gateway', status: 'conectado', bot_ativo: false }]);
    assert.equal((await q(db, `SELECT 1 FROM public.produtos WHERE partner_id = $1`, [mentee.partnerId])).length, 3);
    assert.equal((await q(db, `SELECT 1 FROM public.rastreamento_config WHERE partner_id = $1`, [mentee.partnerId])).length, 1);
    assert.deepEqual((await q(db, `SELECT tipo FROM public.metas_diarias WHERE partner_id = $1 ORDER BY tipo`, [mentee.partnerId])).map((x) => x.tipo),
      ['followups', 'novas_conversas', 'vendas_valor']);
  });

  test('15 conversas (14 individuais e 1 grupo), telefones fictícios 5599, mensagens dos dois lados', async () => {
    const cv = await q(db, `SELECT c.tipo, c.telefone FROM public.bot_conversas c JOIN public.bot_conexoes x ON x.id = c.conexao_id WHERE x.owner_id = $1`, [mentee.partnerId]);
    assert.equal(cv.length, 15);
    assert.equal(cv.filter((c) => c.tipo === 'grupo').length, 1);
    assert.ok(cv.filter((c) => c.tipo === 'individual').every((c) => /^5599/.test(c.telefone)));
    const dir = await q(db, `SELECT DISTINCT m.direcao, m.autor, m.origem_evento FROM public.bot_mensagens m JOIN public.bot_conversas c ON c.id = m.conversa_id
                              JOIN public.bot_conexoes x ON x.id = c.conexao_id WHERE x.owner_id = $1 ORDER BY 1, 2`, [mentee.partnerId]);
    assert.deepEqual(dir.map((d) => `${d.direcao}/${d.autor}/${d.origem_evento}`), ['entrada/cliente/tempo_real', 'saida/humano/tempo_real']);
    // 15 conversas espalhadas por anteontem, ontem e hoje (fuso de Cuiabá)
    const dias = await q(db, `SELECT DISTINCT (m.wa_em AT TIME ZONE 'America/Cuiaba')::date::text AS d FROM public.bot_mensagens m ORDER BY 1`);
    assert.ok(dias.length >= 3, JSON.stringify(dias));
  });

  test('origens: anúncio por rastreio, anúncio CTWA e indicação; grupo e categorias', async () => {
    const ks = await q(db, `SELECT nome, categoria, origem_tipo, origem_fonte, origem_campanha FROM public.contatos WHERE partner_id = $1 ORDER BY nome`, [mentee.partnerId]);
    const por = Object.fromEntries(ks.map((k) => [k.nome, k]));
    assert.equal(por['Ana Demo'].origem_fonte, 'rastreio');
    assert.equal(por['Ana Demo'].origem_campanha, 'Anúncio Mentoria (demo)');
    assert.equal(por['Bruno Demo'].origem_fonte, 'ctwa');
    assert.equal(por['Bruno Demo'].origem_tipo, 'trafego_pago');
    assert.equal(por['Kleber Demo'].origem_tipo, 'indicacao');
    assert.equal(por['Carla Demo'].categoria, 'cliente');
    assert.equal(por['Gráfica Demo'].categoria, 'fornecedor');
    assert.equal(por['Mãe Demo'].categoria, 'pessoal');
    assert.equal(por['Turma Mentoria Demo'].categoria, 'grupo');
    assert.equal(por['Zé Demo'].categoria, 'nao_classificado');
    const ad = await um(db, `SELECT m.anuncio FROM public.bot_mensagens m WHERE m.anuncio IS NOT NULL`);
    assert.equal(ad.anuncio.sourceId, '120000000000001');
  });

  test('crm_metricas_dia de ontem: novas, tráfego pago, vendas, resposta', async () => {
    const m = (await um(db, `SELECT public.crm_metricas_dia($1, $2::date) AS r`, [mentee.partnerId, ontem])).r;
    assert.equal(m.novas, 7);                       // Ana, Bruno, Diego, Hugo, Julia, Kleber e o Zé
    assert.equal(m.trafego_pago.total, 2);
    assert.deepEqual(m.trafego_pago.por_fonte, { ctwa: 1, rastreio: 1 });
    assert.equal(m.vendas.confirmado_qtd, 1);
    assert.equal(Number(m.vendas.confirmado_valor), 497);
    assert.equal(m.vendas.a_confirmar_qtd, 2);
    assert.equal(Number(m.vendas.a_confirmar_valor), 10497);
    assert.equal(m.grupos, 1);
    assert.ok(m.resposta.mediana_min > 0 && m.resposta.mediana_min < 60, `mediana ${m.resposta.mediana_min}`);
    assert.equal(m.mensagens.enviadas_robo, 0);
    const metas = Object.fromEntries(m.metas.map((x) => [x.tipo, Number(x.realizado)]));
    assert.equal(metas.novas_conversas, 7);
    assert.equal(metas.vendas_valor, 497);
  });

  test('vendas: Pix da Carla confirmada, comprovante da Diego e golpe do Zé a confirmar com alerta', async () => {
    const vs = await q(db, `SELECT k.nome, v.status, v.valor::float AS valor, v.forma, v.tipo_evidencia, v.alerta, v.evidencia_verificada, v.dia::text AS dia
                              FROM public.vendas v JOIN public.contatos k ON k.id = v.contato_id WHERE v.partner_id = $1 ORDER BY k.nome`, [mentee.partnerId]);
    const por = Object.fromEntries(vs.map((v) => [v.nome, v]));
    assert.deepEqual(Object.keys(por), ['Carla Demo', 'Diego Demo', 'Zé Demo']);
    assert.equal(por['Carla Demo'].status, 'confirmada');
    assert.equal(por['Carla Demo'].valor, 497);
    assert.equal(por['Carla Demo'].dia, ontem);
    assert.equal(por['Diego Demo'].status, 'pendente_confirmacao');
    assert.equal(por['Diego Demo'].tipo_evidencia, 'comprovante_enviado_pelo_cliente');
    assert.equal(por['Diego Demo'].alerta, null);
    assert.equal(por['Zé Demo'].status, 'pendente_confirmacao');
    assert.equal(por['Zé Demo'].alerta, 'texto_suspeito_de_manipulacao');
    const msg = await um(db, `SELECT m.corpo, m.autor FROM public.vendas v JOIN public.bot_mensagens m ON m.id = v.evidencia_mensagem_id
                               JOIN public.contatos k ON k.id = v.contato_id WHERE k.nome = 'Carla Demo'`);
    assert.equal(msg.autor, 'humano');
    assert.match(msg.corpo, /^Pix recebido, R\$ 497,00/);
    // a configuração da empresa voltou ao que era (não havia linha)
    assert.equal((await q(db, `SELECT 1 FROM public.ia_retroalimentacao_config WHERE partner_id = $1`, [mentee.partnerId])).length, 0);
  });

  test('crm_pendencias: esperando você, follow-up vencido e cliente que sumiu (sugestão junto)', async () => {
    const ps = await q(db, `SELECT nome, motivo, mensagem_sugerida, sugestao_id FROM public.crm_pendencias($1)`, [mentee.partnerId]);
    const por = Object.fromEntries(ps.map((p) => [p.nome, p]));
    for (const nome of ['Ana Demo', 'Bruno Demo', 'Iara Demo', 'Julia Demo']) {
      assert.equal(por[nome]?.motivo, 'followup_vencido', nome);
      assert.ok(por[nome].mensagem_sugerida && por[nome].sugestao_id, `${nome} sem mensagem sugerida`);
    }
    assert.equal(por['Diego Demo']?.motivo, 'followup_vencido');
    assert.equal(por['Fábio Demo']?.motivo, 'cliente_sumiu');
    // "esperando há horas" só tem horas se já passou da meia-noite + 30 min em Cuiabá
    if (antes.__min > 40) assert.equal(por['Eva Demo']?.motivo, 'esperando_voce');
    for (const fora of ['Carla Demo', 'Hugo Demo', 'Gráfica Demo', 'Mãe Demo', 'Turma Mentoria Demo']) assert.ok(!por[fora], fora);
  });

  test('relatório de ontem aplicado, com resumo, contatos e mensagens sugeridas', async () => {
    const r = await um(db, `SELECT status, engine, resumo_executivo, resumo, jsonb_array_length(leads_analisados) AS leads,
                                   metricas->'vendas' AS vendas, total_conversas, vendas_fechadas FROM public.ia_relatorios_diarios
                             WHERE partner_id = $1 AND data_referencia = $2::date`, [mentee.partnerId, ontem]);
    assert.equal(r.status, 'concluido');
    assert.equal(r.leads, 11);
    assert.match(r.resumo_executivo, /7 conversas novas/);
    assert.equal(r.resumo.foco_sugerido.length, 3);
    assert.equal(r.resumo.dicas_mensagens.length, 2);
    assert.equal(r.vendas_fechadas, 1);
    assert.equal(Number(r.vendas.confirmado_valor), 497);
    const lote = await um(db, `SELECT status, versao, partes, conversas FROM public.ia_lotes WHERE partner_id = $1`, [mentee.partnerId]);
    assert.deepEqual(lote, { status: 'concluido', versao: 1, partes: 1, conversas: 11 });
    const sug = await um(db, `SELECT count(*)::int AS n FROM public.ia_sugestoes WHERE partner_id = $1 AND tipo = 'mensagem' AND status = 'pendente'`, [mentee.partnerId]);
    assert.ok(sug.n >= 8);
    const tarefas = await um(db, `SELECT count(*)::int AS n FROM public.tarefas_followup WHERE partner_id = $1 AND status = 'aberta'`, [mentee.partnerId]);
    assert.ok(tarefas.n >= 8);
  });

  test('funil: cartões nas etapas certas e etiquetas da IA', async () => {
    const cs = await q(db, `SELECT ca.titulo, col.etapa_chave FROM public.crm_cartoes ca JOIN public.crm_colunas col ON col.id = ca.coluna_id
                             WHERE ca.quadro_id = $1`, [mentee.quadroId]);
    const por = Object.fromEntries(cs.map((c) => [c.titulo, c.etapa_chave]));
    assert.equal(por['Carla Demo'], 'ganho');
    assert.equal(por['Ana Demo'], 'proposta_enviada');
    assert.equal(por['Fábio Demo'], 'proposta_enviada');
    assert.equal(por['Diego Demo'], 'aguardando_pagamento');
    assert.equal(por['Hugo Demo'], 'perdido');
    assert.equal(por['Bruno Demo'], 'negociando');
    assert.ok(!('Turma Mentoria Demo' in por));
    const et = await q(db, `SELECT nome FROM public.crm_etiquetas WHERE quadro_id = $1 ORDER BY nome`, [mentee.quadroId]);
    assert.deepEqual(et.map((e) => e.nome), ['anuncio', 'comprovante', 'demo', 'indicacao', 'pediu_preco']);
  });

  test('mentor_painel traz a empresa com números, conexão e relatório coerentes', async () => {
    const [l] = (await comoPapel(db, 'service_role', null, () => q(db, `SELECT * FROM public.mentor_painel()`))).filter((x) => x.partner_id === mentee.partnerId);
    assert.equal(l.empresa, 'Empresa de Teste');
    assert.equal(l.conexoes.length, 1);
    assert.equal(l.conexoes[0].status, 'conectado');
    assert.equal(l.vendas_a_confirmar, 2);
    assert.deepEqual(l.relatorio, { dia: ontem, lote: 'concluido', analise: 'aplicada', partes: 1 });
    assert.equal(l.numeros.novas, 2);               // Eva e Gabi (hoje)
    assert.equal(l.numeros.followups_vencidos, 5);   // Ana, Bruno, Diego, Iara e Julia
    assert.ok(l.ultima_atividade);
    const ontemPainel = (await comoPapel(db, 'service_role', null, () =>
      q(db, `SELECT * FROM public.mentor_painel($1::date)`, [ontem]))).find((x) => x.partner_id === mentee.partnerId);
    assert.equal(ontemPainel.numeros.novas, 7);
    assert.equal(ontemPainel.numeros.trafego_pago, 2);
    assert.equal(Number(ontemPainel.numeros.vendas_confirmado_valor), 497);
    // a empresa de verdade não foi tocada
    const real = (await comoPapel(db, 'service_role', null, () => q(db, `SELECT * FROM public.mentor_painel()`))).find((x) => x.partner_id === outra.partnerId);
    assert.equal(real.vendas_a_confirmar, 0);
  });

  test('o JSON da IA que a demo aplicou é válido no contrato v1', async () => {
    const a = await um(db, `SELECT payload FROM public.ia_analises WHERE partner_id = $1`, [mentee.partnerId]);
    const dir = mkdtempSync(path.join(tmpdir(), 'demo-'));
    const arq = path.join(dir, 'analise.json');
    writeFileSync(arq, JSON.stringify(a.payload));
    const lote = await um(db, `SELECT id FROM public.ia_lotes WHERE partner_id = $1`, [mentee.partnerId]);
    const saida = execFileSync(process.execPath, [path.join(raiz, 'ia/rotina/scripts/validar.mjs'), arq], { encoding: 'utf8' });
    assert.match(saida, /^OK: 11 contatos/);
  });

  test('o que vai para a IA nunca tem telefone: o lote da demo não carrega 5599', async () => {
    const l = await um(db, `SELECT public.ia_montar_contexto(id) AS t FROM public.ia_lotes WHERE partner_id = $1`, [mentee.partnerId]);
    assert.ok(!/5599\d{6}/.test(l.t ?? ''));
  });

  test('demo-remover apaga tudo da demo e deixa o resto do banco igual', async () => {
    await db.exec(com(REMOVER, EMAIL));
    const { __min, ...base } = antes;
    const depois = await foto(db);
    const difs = Object.keys(base).filter((t) => depois[t].n !== base[t].n || depois[t].h !== base[t].h);
    assert.deepEqual(difs, []);
    assert.equal((await um(db, `SELECT count(*)::int AS n FROM public.contatos WHERE telefone ~ '^5599' OR jid LIKE '1203630000000000%'`)).n, 0);
    assert.equal((await um(db, `SELECT count(*)::int AS n FROM public.bot_conexoes WHERE nome LIKE 'DEMO %'`)).n, 0);
  });

  test('remover duas vezes recusa sem apagar nada; e dá para criar de novo depois de remover', async () => {
    await assert.rejects(db.exec(com(REMOVER, EMAIL)), /não tem dados de demonstração/);
    await db.exec(com(CRIAR, EMAIL));
    assert.equal((await um(db, `SELECT count(*)::int AS n FROM public.bot_conversas c JOIN public.bot_conexoes x ON x.id = c.conexao_id WHERE x.owner_id = $1`, [mentee.partnerId])).n, 15);
    await db.exec(com(REMOVER, EMAIL));
    const { __min, ...base } = antes;
    const depois = await foto(db);
    assert.deepEqual(Object.keys(base).filter((t) => depois[t].n !== base[t].n || depois[t].h !== base[t].h), []);
  });
});
