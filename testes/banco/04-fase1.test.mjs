// banco/migracoes/002-fase1-captura.sql: idempotência, ingestão dos eventos do gateway
// (gateway/CONTRATO.md), fila de saída com reserva e as travas do robô.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { novoBanco, ler, M002, FASE1, MIGRACOES, comoUsuario, comoPapel, tentar, criarUsuario, popularEmpresa } from './pg.mjs';
import { waIdDaFila } from '../../gateway/mapear.mjs';

const SQL002 = ler(M002);
const NEGADO = /permission denied/;
const TEL = '556599990000';
const LID = '103843987759126@lid';

const q = async (db, sql, params) => (await db.query(sql, params)).rows;
const um = async (db, sql, params) => (await q(db, sql, params))[0];

async function bancoFase1() {
  return novoBanco({ extras: FASE1 });
}

// Empresa completa (funil, colunas) com uma conexão do jeito pedido.
async function empresa(db, { email, modo = 'gateway', botAtivo = false, grupos = [] }) {
  const u = await criarUsuario(db, { email, empresa: `Empresa ${email}` });
  const c = await um(db,
    `INSERT INTO public.bot_conexoes (escopo, owner_id, nome, modo, bot_ativo, opcoes)
     VALUES ('parceiro', $1, 'Número', $2, $3, jsonb_build_object('gruposPermitidos', $4::jsonb, 'historicoDias', 7))
     RETURNING id`, [u.partnerId, modo, botAtivo, JSON.stringify(grupos)]);
  return { ...u, conexaoId: c.id };
}

const registrar = async (db, conexaoId, eventos) =>
  (await um(db, `SELECT public.bot_registrar_eventos($1, $2::jsonb) AS r`, [conexaoId, JSON.stringify(eventos)])).r;

// O exemplo de mensagem do CONTRATO §3.1, em texto e com a hora de agora.
function mensagem(extra = {}) {
  return {
    tipo: 'mensagem', waId: '3EB0C767D82A1E4F1B2C', chatJid: `${TEL}@s.whatsapp.net`, grupo: false, grupoNome: null,
    telefone: TEL, telefoneConfirmado: true, lid: LID, nome: 'João', deMim: false,
    participanteJid: null, participanteTelefone: null, participanteNome: null,
    tipoMidia: 'texto', corpo: 'Oi! Vi o anúncio do plano', midia: null, citadoWaId: null, anuncio: null,
    origemEvento: 'tempo_real', waEm: new Date().toISOString(), ...extra,
  };
}

const conversas = (db, conexaoId) => q(db, `SELECT * FROM public.bot_conversas WHERE conexao_id = $1 ORDER BY created_at`, [conexaoId]);
const mensagens = (db, conexaoId) => q(db,
  `SELECT m.* FROM public.bot_mensagens m JOIN public.bot_conversas c ON c.id = m.conversa_id
    WHERE c.conexao_id = $1 ORDER BY m.momento, m.created_at`, [conexaoId]);
const reservar = (db, conexaoId, limite = 10) => q(db, `SELECT * FROM public.bot_reservar_fila($1, $2)`, [conexaoId, limite]);
const confirmar = async (db, id, status, extra = {}) =>
  (await um(db, `SELECT public.bot_confirmar_envio($1, $2, $3, $4, $5) AS r`,
    [id, status, extra.waId ?? null, extra.erro ?? null, extra.conexaoId ?? null])).r;

// Estrutura e permissões que a 002 mexe, para comparar a 1ª e a 2ª execução.
async function retrato(db) {
  const tabelas = `('bot_conexoes', 'bot_conversas', 'bot_mensagens', 'wa_contatos_base')`;
  return {
    colunas: await q(db, `SELECT table_name, column_name, data_type, is_nullable, column_default, generation_expression
                            FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ${tabelas}
                           ORDER BY 1, 2`),
    restricoes: await q(db, `SELECT c.relname AS t, k.conname, pg_get_constraintdef(k.oid) AS def
                               FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
                              WHERE c.relname IN ${tabelas} ORDER BY 1, 2`),
    indices: await q(db, `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ${tabelas} ORDER BY 1`),
    gatilhos: await q(db, `SELECT c.relname AS t, g.tgname FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
                            WHERE NOT g.tgisinternal AND c.relname IN ${tabelas} ORDER BY 1, 2`),
    funcoes: await q(db, `SELECT p.oid::regprocedure::text AS f, md5(p.prosrc) AS corpo,
                                 has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                                 has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
                            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                           WHERE n.nspname = 'public' ORDER BY 1`),
    policies: await q(db, `SELECT tablename, policyname, cmd, roles::text, qual FROM pg_policies
                            WHERE schemaname = 'public' ORDER BY 1, 2`),
    privilegios: await q(db, `SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
                               WHERE table_schema = 'public' AND table_name IN ${tabelas}
                                 AND grantee IN ('anon', 'authenticated') ORDER BY 1, 2, 3`),
    colunasConexao: await q(db, `SELECT column_name, grantee, privilege_type FROM information_schema.column_privileges
                                  WHERE table_schema = 'public' AND table_name = 'bot_conexoes'
                                    AND grantee IN ('anon', 'authenticated') ORDER BY 1, 2, 3`),
  };
}

// Linhas de dados (com updated_at): a 2ª execução não pode tocar em nenhuma.
const dados = async (db) => ({
  conversas: await q(db, `SELECT * FROM public.bot_conversas ORDER BY id`),
  mensagens: await q(db, `SELECT * FROM public.bot_mensagens ORDER BY id`),
  conexoes: await q(db, `SELECT * FROM public.bot_conexoes ORDER BY id`),
});

describe('migração 002', () => {
  test('roda duas vezes: a segunda não muda estrutura, permissões nem dados', async () => {
    const db = await novoBanco({ extras: MIGRACOES });
    const A = await popularEmpresa(db, await criarUsuario(db, { email: 'a@x.com', empresa: 'A' }), '5565900000001');
    await db.query(`INSERT INTO public.bot_mensagens (conversa_id, direcao, corpo, status) VALUES ($1, 'saida', 'oi', 'pendente')`, [A.conversaId]);
    await db.exec(SQL002);
    const estrutura1 = await retrato(db);
    const dados1 = await dados(db);
    await db.exec(SQL002);
    assert.deepEqual(await retrato(db), estrutura1);
    assert.deepEqual(await dados(db), dados1);
  });

  test('conserta o que o conector antigo gravou: grupo, LID como telefone e fila sem wa_id', async () => {
    const db = await novoBanco({ extras: MIGRACOES });
    const u = await criarUsuario(db, { email: 'velho@x.com', empresa: 'Velha' });
    const { id: cx } = await um(db, `INSERT INTO public.bot_conexoes (escopo, owner_id, nome) VALUES ('parceiro', $1, 'PC') RETURNING id`, [u.partnerId]);
    const grupo = await um(db, `INSERT INTO public.bot_conversas (conexao_id, telefone, jid, estado)
                                VALUES ($1, '120363000000000001', '120363000000000001@g.us', 'bot') RETURNING id`, [cx]);
    // corrida do servidor antigo: o mesmo grupo duas vezes (telefones diferentes)
    const repetido = await um(db, `INSERT INTO public.bot_conversas (conexao_id, telefone, jid, created_at)
                                   VALUES ($1, '556500000009', '120363000000000001@g.us', now() + interval '1 minute') RETURNING id`, [cx]);
    const lid = await um(db, `INSERT INTO public.bot_conversas (conexao_id, telefone, jid)
                              VALUES ($1, '103843987759126', '103843987759126@lid') RETURNING id`, [cx]);
    const tel = await um(db, `INSERT INTO public.bot_conversas (conexao_id, telefone, jid)
                              VALUES ($1, '556588887777', '556588887777@s.whatsapp.net') RETURNING id`, [cx]);
    const pend = await um(db, `INSERT INTO public.bot_mensagens (conversa_id, direcao, corpo, status) VALUES ($1, 'saida', 'oi', 'pendente') RETURNING id`, [tel.id]);
    const env = await um(db, `INSERT INTO public.bot_mensagens (conversa_id, direcao, corpo, status, enviada_por) VALUES ($1, 'saida', 'olá', 'enviada', $2) RETURNING id`, [tel.id, u.profileId]);
    await db.query(`INSERT INTO public.bot_mensagens (conversa_id, direcao, corpo) VALUES ($1, 'entrada', 'bom dia')`, [tel.id]);

    await db.exec(SQL002);

    const g = await um(db, `SELECT tipo, telefone, estado FROM public.bot_conversas WHERE id = $1`, [grupo.id]);
    assert.deepEqual(g, { tipo: 'grupo', telefone: null, estado: 'humano' });
    const r = await um(db, `SELECT tipo, telefone, jid FROM public.bot_conversas WHERE id = $1`, [repetido.id]);
    assert.deepEqual(r, { tipo: 'individual', telefone: '556500000009', jid: null }, 'a cópia perde o jid e não fica sem identificação');
    const l = await um(db, `SELECT telefone, lid, telefone_confirmado FROM public.bot_conversas WHERE id = $1`, [lid.id]);
    assert.deepEqual(l, { telefone: null, lid: '103843987759126@lid', telefone_confirmado: false });
    const t = await um(db, `SELECT telefone_confirmado, ultima_entrada_em IS NOT NULL AS entrada, ultima_saida_em IS NOT NULL AS saida
                              FROM public.bot_conversas WHERE id = $1`, [tel.id]);
    assert.deepEqual(t, { telefone_confirmado: true, entrada: true, saida: true });
    const p = await um(db, `SELECT autor, origem_evento, wa_id FROM public.bot_mensagens WHERE id = $1`, [pend.id]);
    assert.deepEqual(p, { autor: 'bot', origem_evento: 'fila', wa_id: waIdDaFila(pend.id) });
    assert.equal((await um(db, `SELECT autor FROM public.bot_mensagens WHERE id = $1`, [env.id])).autor, 'crm');
  });

  test('a 001 rodando de novo depois da 002 não reabre nada', async () => {
    const db = await bancoFase1();
    const antes = await retrato(db);
    await db.exec(ler(MIGRACOES[0]));
    const depois = await retrato(db);
    assert.deepEqual(depois.funcoes, antes.funcoes);
    assert.deepEqual(depois.policies.filter((p) => p.tablename === 'wa_contatos_base'),
      antes.policies.filter((p) => p.tablename === 'wa_contatos_base'));
    assert.ok(!depois.colunasConexao.some((c) => c.column_name === 'webhook_segredo' && c.privilege_type === 'SELECT'));
    assert.ok(depois.colunasConexao.some((c) => c.column_name === 'bot_ativo' && c.grantee === 'authenticated' && c.privilege_type === 'SELECT'));
    await db.exec(SQL002);
    assert.deepEqual(await retrato(db), antes);
  });

  test('nenhuma função nova é executável pelo navegador (anon/authenticated)', async () => {
    const base = await novoBanco({ extras: MIGRACOES });
    const executaveis = async (db) => (await q(db,
      `SELECT p.oid::regprocedure::text AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                                        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')) ORDER BY 1`)).map((r) => r.f);
    const db = await bancoFase1();
    assert.deepEqual(await executaveis(db), await executaveis(base));
    const novas = (await q(db, `SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                 WHERE n.nspname = 'public' AND proname IN ('bot_registrar_eventos', 'bot_reservar_fila',
                                   'bot_confirmar_envio', 'bot_arquivo_completo', 'bot_fundir_conversas')`)).length;
    assert.equal(novas, 5);
  });
});

describe('bot_registrar_eventos (exemplos do gateway/CONTRATO.md)', () => {
  let db;
  before(async () => { db = await bancoFase1(); });

  test('texto do cliente: conversa com telefone, LID e pushName; cartão no funil; repetido não duplica', async () => {
    const E = await empresa(db, { email: 'texto@x.com' });
    const ev = mensagem({ waEm: '2026-10-05T13:22:10.000Z' });
    const r = await registrar(db, E.conexaoId, [ev]);
    assert.deepEqual(r, { processados: 1, erros: [], responder: [] });

    const [c] = await conversas(db, E.conexaoId);
    assert.equal(c.tipo, 'individual');
    assert.equal(c.telefone, TEL);
    assert.equal(c.lid, LID);
    assert.equal(c.nome, 'João');
    assert.equal(c.telefone_confirmado, true);
    assert.equal(c.estado, 'humano', 'robô desligado: ninguém nasce com o robô');
    const [m] = await mensagens(db, E.conexaoId);
    assert.equal(m.direcao, 'entrada');
    assert.equal(m.autor, 'cliente');
    assert.equal(m.status, 'recebida');
    assert.equal(m.origem_evento, 'tempo_real');
    assert.equal(new Date(m.wa_em).toISOString(), '2026-10-05T13:22:10.000Z');
    assert.equal(new Date(m.momento).toISOString(), '2026-10-05T13:22:10.000Z');

    const cartao = await um(db, `SELECT contato_telefone, contato_nome FROM public.crm_cartoes WHERE id = $1`, [c.cartao_id]);
    assert.deepEqual(cartao, { contato_telefone: TEL, contato_nome: 'João' });
    const linha = await q(db, `SELECT corpo FROM public.crm_atividades WHERE cartao_id = $1 ORDER BY created_at`, [c.cartao_id]);
    assert.ok(linha.some((a) => a.corpo === `Cliente: ${ev.corpo}`));

    const r2 = await registrar(db, E.conexaoId, [ev, ev]);
    assert.equal(r2.processados, 2);
    assert.equal((await mensagens(db, E.conexaoId)).length, 1, 'entrega repetida não duplica');
  });

  test('resposta humana pelo celular: saída, autor humano, a conversa sai do robô', async () => {
    const E = await empresa(db, { email: 'humano@x.com', botAtivo: true });
    await registrar(db, E.conexaoId, [mensagem()]);
    assert.equal((await conversas(db, E.conexaoId))[0].estado, 'bot', 'robô ligado e tempo real: nasce com o robô');

    const resposta = mensagem({ waId: '3EB0AAAA0000000000AA', deMim: true, nome: null, corpo: 'Oi João, tudo bem?' });
    const r = await registrar(db, E.conexaoId, [resposta]);
    assert.deepEqual(r.responder, []);
    const m = (await mensagens(db, E.conexaoId)).find((x) => x.wa_id === resposta.waId);
    assert.equal(m.direcao, 'saida');
    assert.equal(m.autor, 'humano');
    assert.equal(m.status, 'enviada');
    assert.ok(m.enviada_em);
    const [c] = await conversas(db, E.conexaoId);
    assert.equal(c.estado, 'humano');
    assert.ok(c.ultima_saida_em, 'saída humana marca o relógio');
    assert.equal(c.nome, 'João', 'pushName do mentorado não sobrescreve o do cliente');
  });

  test('robô: só tempo real, individual, do cliente, com robô ligado e sem resposta humana recente', async () => {
    const E = await empresa(db, { email: 'robo@x.com', botAtivo: true, grupos: ['120363000000000001@g.us'] });
    const r = await registrar(db, E.conexaoId, [
      mensagem({ waId: 'R1', chatJid: '556511110001@s.whatsapp.net', telefone: '556511110001', lid: null }),
      mensagem({ waId: 'R2', chatJid: '556511110002@s.whatsapp.net', telefone: '556511110002', lid: null,
        origemEvento: 'offline', waEm: '2026-10-01T10:00:00.000Z' }),
      mensagem({ waId: 'R3', chatJid: '556511110003@s.whatsapp.net', telefone: '556511110003', lid: null, origemEvento: 'historico',
        waEm: '2026-09-30T10:00:00.000Z' }),
      mensagem({ waId: 'R4', chatJid: '120363000000000001@g.us', grupo: true, grupoNome: 'Alunos', telefone: null, lid: null, nome: null,
        participanteJid: '556511110004@s.whatsapp.net', participanteTelefone: '556511110004', participanteNome: 'Ana' }),
    ]);
    assert.equal(r.processados, 4);
    assert.deepEqual(r.responder.map((x) => x.indice), [0]);
    assert.equal(r.responder[0].texto, 'Oi! Vi o anúncio do plano');
    assert.equal(r.responder[0].telefone, '556511110001');

    const cs = await conversas(db, E.conexaoId);
    const porTel = Object.fromEntries(cs.map((c) => [c.telefone ?? c.jid, c]));
    assert.equal(porTel['556511110001'].estado, 'bot');
    assert.equal(porTel['556511110002'].estado, 'humano', 'offline não nasce com o robô');
    assert.equal(porTel['556511110003'].cartao_id, null, 'histórico não cria cartão');
    assert.equal(porTel['556511110002'].cartao_id !== null, true, 'offline cria cartão');
    const ms = await mensagens(db, E.conexaoId);
    const r2 = ms.find((m) => m.wa_id === 'R2');
    assert.equal(r2.origem_evento, 'offline');
    assert.equal(new Date(r2.wa_em).toISOString(), '2026-10-01T10:00:00.000Z', 'offline guarda a hora do WhatsApp');

    // resposta humana nos últimos 30 min trava o robô mesmo com a conversa em 'bot'
    const c1 = porTel['556511110001'];
    await db.query(`UPDATE public.bot_conversas SET ultima_saida_em = now() - interval '5 minutes' WHERE id = $1`, [c1.id]);
    const r3 = await registrar(db, E.conexaoId, [mensagem({ waId: 'R5', chatJid: '556511110001@s.whatsapp.net', telefone: '556511110001', lid: null })]);
    assert.deepEqual(r3.responder, []);
  });

  test('eco da fila: a saída do CRM vira enviada com autor crm e não duplica como humano', async () => {
    const E = await empresa(db, { email: 'eco@x.com', botAtivo: true });
    await registrar(db, E.conexaoId, [mensagem()]);
    const [c] = await conversas(db, E.conexaoId);
    const fila = await um(db, `INSERT INTO public.bot_mensagens (conversa_id, direcao, corpo, status, enviada_por)
                               VALUES ($1, 'saida', 'Seguem os horários', 'pendente', $2) RETURNING id, autor, origem_evento, wa_id`,
      [c.id, E.profileId]);
    assert.deepEqual([fila.autor, fila.origem_evento, fila.wa_id], ['crm', 'fila', waIdDaFila(fila.id)],
      'wa_id da fila = waIdDaFila(id) do gateway');

    const [res] = await reservar(db, E.conexaoId);
    assert.deepEqual(res, { id: fila.id, conexao_id: E.conexaoId, para: `${TEL}@s.whatsapp.net`, corpo: 'Seguem os horários', tipo: 'texto' });

    // o eco chega antes da confirmação (ou a confirmação se perdeu)
    const eco = mensagem({ waId: waIdDaFila(fila.id), deMim: true, nome: null, corpo: 'Seguem os horários' });
    const r = await registrar(db, E.conexaoId, [eco, eco]);
    assert.deepEqual(r.erros, []);
    const ms = await mensagens(db, E.conexaoId);
    assert.equal(ms.filter((m) => m.wa_id === waIdDaFila(fila.id)).length, 1);
    const linha = ms.find((m) => m.id === fila.id);
    assert.deepEqual([linha.status, linha.autor, linha.reservada_ate], ['enviada', 'crm', null]);
    assert.equal(ms.filter((m) => m.autor === 'humano').length, 0);
    assert.equal(await confirmar(db, fila.id, 'enviada', { waId: waIdDaFila(fila.id), conexaoId: E.conexaoId }), 'ja_confirmada');
  });

  test('grupo permitido entra com participante; não permitido não entra; robô nunca em grupo', async () => {
    const G = '120363000000000001@g.us';
    const E = await empresa(db, { email: 'grupo@x.com', botAtivo: true, grupos: [G] });
    const r = await registrar(db, E.conexaoId, [
      mensagem({ waId: 'G1', chatJid: G, grupo: true, grupoNome: 'Alunos turma 3', telefone: null, lid: null, nome: null,
        participanteJid: '556577776666@s.whatsapp.net', participanteTelefone: '556577776666', participanteNome: 'Maria' }),
      mensagem({ waId: 'G2', chatJid: '120363000000000002@g.us', grupo: true, grupoNome: 'Família', telefone: null, lid: null, nome: null,
        participanteJid: '556577775555@s.whatsapp.net', participanteTelefone: '556577775555', participanteNome: 'Tia' }),
    ]);
    assert.deepEqual([r.processados, r.erros, r.responder], [2, [], []]);
    const cs = await conversas(db, E.conexaoId);
    assert.equal(cs.length, 1, 'grupo não marcado não entra');
    assert.deepEqual([cs[0].tipo, cs[0].telefone, cs[0].grupo_nome, cs[0].estado, cs[0].cartao_id],
      ['grupo', null, 'Alunos turma 3', 'humano', null]);
    const [m] = await mensagens(db, E.conexaoId);
    assert.deepEqual([m.participante_jid, m.participante_telefone, m.participante_nome, m.autor],
      ['556577776666@s.whatsapp.net', '556577776666', 'Maria', 'cliente']);

    // trava 3: nem robô, nem campanha, nem a fila em grupo; e o grupo não volta para o robô
    for (const autor of ['bot', 'campanha', 'crm']) {
      const t = await tentar(db, `INSERT INTO public.bot_mensagens (conversa_id, direcao, corpo, status, autor)
                                  VALUES ($1, 'saida', 'oi', 'pendente', $2)`, [cs[0].id, autor]);
      assert.match(t.erro || '', /grupo/, `autor ${autor} entrou na fila do grupo`);
    }
    const t = await tentar(db, `UPDATE public.bot_conversas SET estado = 'bot' WHERE id = $1`, [cs[0].id]);
    assert.match(t.erro || '', /bot_conversas_grupo_sem_robo/);
    // o mentorado falando no grupo é normal
    const minha = await registrar(db, E.conexaoId, [mensagem({ waId: 'G3', chatJid: G, grupo: true, telefone: null, lid: null,
      nome: null, deMim: true, corpo: 'Bom dia, turma' })]);
    assert.deepEqual(minha.erros, []);
  });

  test('LID primeiro, telefone depois: a mesma conversa ganha o telefone', async () => {
    const E = await empresa(db, { email: 'lid@x.com' });
    await registrar(db, E.conexaoId, [mensagem({ waId: 'L1', chatJid: LID, telefone: null, telefoneConfirmado: false, lid: LID })]);
    let cs = await conversas(db, E.conexaoId);
    assert.deepEqual([cs.length, cs[0].telefone, cs[0].telefone_confirmado, cs[0].jid], [1, null, false, LID]);
    const cartao = await um(db, `SELECT contato_telefone FROM public.crm_cartoes WHERE id = $1`, [cs[0].cartao_id]);
    assert.equal(cartao.contato_telefone, null);

    await registrar(db, E.conexaoId, [mensagem({ waId: 'L2', chatJid: LID, telefone: TEL, telefoneConfirmado: true, lid: LID })]);
    cs = await conversas(db, E.conexaoId);
    assert.deepEqual([cs.length, cs[0].telefone, cs[0].telefone_confirmado], [1, TEL, true]);
    assert.equal((await um(db, `SELECT contato_telefone FROM public.crm_cartoes WHERE id = $1`, [cs[0].cartao_id])).contato_telefone, TEL);
    assert.equal((await mensagens(db, E.conexaoId)).length, 2);
  });

  test('LID e telefone em duas conversas: juntam quando uma mensagem liga os dois', async () => {
    const E = await empresa(db, { email: 'funde@x.com' });
    await registrar(db, E.conexaoId, [
      mensagem({ waId: 'F1', chatJid: LID, telefone: null, telefoneConfirmado: false, lid: LID, corpo: 'pelo LID' }),
      mensagem({ waId: 'F2', chatJid: `${TEL}@s.whatsapp.net`, telefone: TEL, lid: null, corpo: 'pelo telefone' }),
    ]);
    assert.equal((await conversas(db, E.conexaoId)).length, 2);
    await db.query(`UPDATE public.bot_conversas SET privacidade = 'so_metadados' WHERE conexao_id = $1 AND telefone IS NULL`, [E.conexaoId]);

    // a reentrega de F1 pelo LID continua repetida; F3 traz telefone + LID
    const r = await registrar(db, E.conexaoId, [
      mensagem({ waId: 'F1', chatJid: LID, telefone: null, lid: LID, corpo: 'pelo LID' }),
      mensagem({ waId: 'F3', chatJid: `${TEL}@s.whatsapp.net`, telefone: TEL, lid: LID, corpo: 'agora junta' }),
    ]);
    assert.deepEqual(r.erros, []);
    const cs = await conversas(db, E.conexaoId);
    assert.equal(cs.length, 1);
    assert.deepEqual([cs[0].telefone, cs[0].lid, cs[0].jid, cs[0].privacidade], [TEL, LID, `${TEL}@s.whatsapp.net`, 'so_metadados']);
    const ms = await mensagens(db, E.conexaoId);
    assert.deepEqual(ms.map((m) => m.wa_id).sort(), ['F1', 'F2', 'F3']);
    assert.ok(ms.every((m) => m.corpo === null), 'a marcação manual de uma vale para a pessoa (C16)');

    // depois de juntar, mensagem que chega pelo LID cai na mesma conversa
    await registrar(db, E.conexaoId, [mensagem({ waId: 'F4', chatJid: LID, telefone: null, lid: LID })]);
    assert.equal((await conversas(db, E.conexaoId)).length, 1);
  });

  test('anúncio CTWA fica bruto na mensagem (só as chaves do contrato); nunca em deMim', async () => {
    const E = await empresa(db, { email: 'ctwa@x.com' });
    const anuncio = {
      sourceType: 'ad', sourceId: '120210000000000', sourceUrl: 'https://fb.me/abc', ctwaClid: 'AfcXYZ',
      titulo: 'Plano trimestral', corpo: 'Treine 3x por semana', conversionSource: 'FB_Ads',
      entryPointConversionSource: 'ctwa_ad', entryPointConversionApp: 'instagram',
    };
    await registrar(db, E.conexaoId, [
      mensagem({ waId: 'A1', anuncio: { ...anuncio, lixo: 'x', vazio: '' } }),
      mensagem({ waId: 'A2', deMim: true, nome: null, anuncio }),
    ]);
    const ms = await mensagens(db, E.conexaoId);
    assert.deepEqual(ms.find((m) => m.wa_id === 'A1').anuncio, anuncio);
    assert.equal(ms.find((m) => m.wa_id === 'A2').anuncio, null);
    const cols = (await q(db, `SELECT column_name FROM information_schema.columns
                                WHERE table_schema = 'public' AND table_name = 'bot_conversas'`)).map((c) => c.column_name);
    assert.ok(!cols.some((c) => c.startsWith('origem')), 'C3: a captura não decide a origem do lead');
  });

  test('mídia: áudio de voz, visualização única que chega vazia e depois com conteúdo', async () => {
    const E = await empresa(db, { email: 'midia@x.com' });
    await registrar(db, E.conexaoId, [
      mensagem({ waId: 'M1', tipoMidia: 'audio', corpo: null, midia: { mimetype: 'audio/ogg; codecs=opus', duracaoSeg: 42, ptt: true, tamanho: 81234 } }),
      mensagem({ waId: 'M2', tipoMidia: 'outro', corpo: null, midia: { visualizacaoUnica: true } }),
    ]);
    await registrar(db, E.conexaoId, [
      mensagem({ waId: 'M2', tipoMidia: 'imagem', corpo: 'olha isso', midia: { mimetype: 'image/jpeg', visualizacaoUnica: true } }),
    ]);
    const ms = await mensagens(db, E.conexaoId);
    const audio = ms.find((m) => m.wa_id === 'M1');
    assert.deepEqual([audio.tipo, audio.midia], ['audio', { mimetype: 'audio/ogg; codecs=opus', duracaoSeg: 42, ptt: true, tamanho: 81234 }]);
    const unica = ms.find((m) => m.wa_id === 'M2');
    assert.deepEqual([unica.tipo, unica.corpo, unica.midia], ['imagem', 'olha isso', { mimetype: 'image/jpeg', visualizacaoUnica: true }]);
    assert.equal(ms.length, 2);
  });

  test('recibo: lida na saída e na entrada; waId desconhecido não é erro; status inválido é', async () => {
    const E = await empresa(db, { email: 'recibo@x.com' });
    await registrar(db, E.conexaoId, [
      mensagem({ waId: 'E1' }),
      mensagem({ waId: 'S1', deMim: true, nome: null, corpo: 'resposta' }),
    ]);
    const em = '2026-10-05T13:30:00.000Z';
    const r = await registrar(db, E.conexaoId, [
      { tipo: 'recibo', waId: 'S1', chatJid: LID, deMim: true, status: 'entregue', em: '2026-10-05T13:29:00.000Z' },
      { tipo: 'recibo', waId: 'S1', chatJid: LID, deMim: true, status: 'lida', em },
      { tipo: 'recibo', waId: 'E1', chatJid: `${TEL}@s.whatsapp.net`, deMim: false, status: 'lida', em },
      { tipo: 'recibo', waId: 'NAO-EXISTE', chatJid: `${TEL}@s.whatsapp.net`, deMim: true, status: 'lida', em },
      { tipo: 'recibo', waId: 'S1', chatJid: LID, deMim: true, status: 'visto', em },
      { tipo: 'recibo', waId: 'S1', chatJid: LID, deMim: true, status: 'lida', em: '2026-10-05T15:00:00.000Z' },
    ]);
    assert.equal(r.processados, 5);
    assert.deepEqual(r.erros.map((e) => e.indice), [4]);
    const ms = await mensagens(db, E.conexaoId);
    const s1 = ms.find((m) => m.wa_id === 'S1');
    assert.equal(new Date(s1.wa_entregue_em).toISOString(), '2026-10-05T13:29:00.000Z');
    assert.equal(new Date(s1.wa_lida_em).toISOString(), em, 'o primeiro "lida" vale; repetir não muda');
    const e1 = ms.find((m) => m.wa_id === 'E1');
    assert.equal(new Date(e1.wa_lida_em).toISOString(), em, 'mentorado viu no celular');
    assert.equal(e1.wa_entregue_em, null);
  });

  test('edição troca o texto; apagada só marca e guarda o corpo (C16); waId desconhecido ignora', async () => {
    const E = await empresa(db, { email: 'edicao@x.com' });
    await registrar(db, E.conexaoId, [mensagem({ waId: 'D1', corpo: 'o valor é R$ 300' })]);
    const r = await registrar(db, E.conexaoId, [
      { tipo: 'edicao', waId: 'D1', chatJid: `${TEL}@s.whatsapp.net`, corpo: 'o valor certo é R$ 350', waEm: '2026-10-05T13:25:02.114Z' },
      { tipo: 'edicao', waId: 'D1', chatJid: `${TEL}@s.whatsapp.net`, corpo: 'versão velha', waEm: '2026-10-05T13:20:00.000Z' },
      { tipo: 'apagada', waId: 'D1', chatJid: `${TEL}@s.whatsapp.net`, waEm: '2026-10-05T13:26:40.000Z' },
      { tipo: 'apagada', waId: 'D1', chatJid: `${TEL}@s.whatsapp.net`, waEm: '2026-10-05T13:27:00.000Z' },
      { tipo: 'apagada', waId: 'XX', chatJid: `${TEL}@s.whatsapp.net`, waEm: '2026-10-05T13:26:40.000Z' },
      { tipo: 'edicao', waId: 'XX', chatJid: `${TEL}@s.whatsapp.net`, corpo: 'x', waEm: '2026-10-05T13:26:40.000Z' },
    ]);
    assert.deepEqual([r.processados, r.erros], [6, []]);
    const [m] = await mensagens(db, E.conexaoId);
    assert.equal(m.corpo, 'o valor certo é R$ 350', 'edição velha que chega depois não volta o texto');
    assert.equal(new Date(m.editada_em).toISOString(), '2026-10-05T13:25:02.114Z');
    assert.equal(new Date(m.apagada_em).toISOString(), '2026-10-05T13:26:40.000Z');
  });

  test('privacidade: so_metadados guarda sem corpo e apaga o que havia; ignorar não grava nada', async () => {
    const E = await empresa(db, { email: 'privacidade@x.com' });
    await registrar(db, E.conexaoId, [mensagem({ waId: 'P1', corpo: 'assunto pessoal',
      tipoMidia: 'documento', midia: { mimetype: 'application/pdf', nomeArquivo: 'exame.pdf' } })]);
    const [c] = await conversas(db, E.conexaoId);
    await db.query(`UPDATE public.bot_conversas SET privacidade = 'so_metadados' WHERE id = $1`, [c.id]);
    let [m] = await mensagens(db, E.conexaoId);
    assert.deepEqual([m.corpo, m.midia], [null, { mimetype: 'application/pdf' }], 'marcação manual apaga o que já estava gravado');

    await registrar(db, E.conexaoId, [
      mensagem({ waId: 'P2', corpo: 'mais um assunto pessoal' }),
      { tipo: 'edicao', waId: 'P1', chatJid: `${TEL}@s.whatsapp.net`, corpo: 'texto editado', waEm: new Date().toISOString() },
    ]);
    const ms = await mensagens(db, E.conexaoId);
    assert.equal(ms.length, 2);
    assert.ok(ms.every((x) => x.corpo === null));

    await db.query(`UPDATE public.bot_conversas SET privacidade = 'ignorar' WHERE id = $1`, [c.id]);
    const r = await registrar(db, E.conexaoId, [mensagem({ waId: 'P3', corpo: 'não grava' })]);
    assert.deepEqual([r.processados, r.erros], [1, []]);
    assert.equal((await mensagens(db, E.conexaoId)).length, 2, 'ignorar: nada gravado');
  });

  test('chats_base semeia a base sem corpo; repetido com null não apaga', async () => {
    const E = await empresa(db, { email: 'base@x.com' });
    const r = await registrar(db, E.conexaoId, [
      { tipo: 'chats_base', chats: [
        { jid: '556599990000@s.whatsapp.net', telefone: '556599990000', lid: '111111111111111@lid', nome: 'João Academia', ultimoEm: '2026-07-01T18:03:11.000Z' },
        { jid: '222222222222222@lid', telefone: null, lid: '222222222222222@lid', nome: null, ultimoEm: null },
        { jid: '120363000000000001@g.us', telefone: null, lid: null, nome: 'grupo não entra', ultimoEm: null },
        { jid: 'status@broadcast', nome: 'x' },
      ] },
      { tipo: 'chats_base', chats: [
        { jid: '556599990000@s.whatsapp.net', telefone: null, lid: null, nome: null, ultimoEm: '2026-06-01T00:00:00.000Z' },
      ] },
    ]);
    assert.deepEqual(r.erros, []);
    const base = await q(db, `SELECT jid, telefone, lid, nome, ultimo_em FROM public.wa_contatos_base WHERE conexao_id = $1 ORDER BY jid`, [E.conexaoId]);
    assert.equal(base.length, 2);
    assert.deepEqual(base[1], { jid: '556599990000@s.whatsapp.net', telefone: '556599990000', lid: '111111111111111@lid',
      nome: 'João Academia', ultimo_em: new Date('2026-07-01T18:03:11.000Z') });
  });

  test('status, QR, código, grupos e batimento vão para a conexão', async () => {
    const E = await empresa(db, { email: 'conexao@x.com' });
    await db.query(`UPDATE public.bot_conexoes SET pareamento = '{"metodo":"codigo","telefone":"5565988887777","solicitadoEm":"2026-10-07T14:58:00.000Z","estado":"solicitado"}' WHERE id = $1`, [E.conexaoId]);
    const r = await registrar(db, E.conexaoId, [
      { tipo: 'status', status: 'aguardando_codigo' },
      { tipo: 'codigo_pareamento', codigo: 'ABCD1234' },
      { tipo: 'grupos', grupos: [{ jid: '120363000000000001@g.us', nome: 'Alunos turma 3', participantes: 42 }, { jid: 'invalido', nome: 'x' }] },
      { tipo: 'batimento', versao: '2.00.00' },
      { tipo: 'status', status: 'voando' },
    ]);
    assert.deepEqual([r.processados, r.erros.map((e) => e.indice)], [4, [4]]);
    let c = await um(db, `SELECT status, pareamento, grupos_disponiveis, versao, visto_em FROM public.bot_conexoes WHERE id = $1`, [E.conexaoId]);
    assert.equal(c.status, 'aguardando_codigo');
    assert.deepEqual([c.pareamento.codigo, c.pareamento.estado, c.pareamento.metodo, c.pareamento.solicitadoEm],
      ['ABCD1234', 'aguardando_codigo', 'codigo', '2026-10-07T14:58:00.000Z']);
    assert.deepEqual(c.grupos_disponiveis, [{ jid: '120363000000000001@g.us', nome: 'Alunos turma 3', participantes: 42 }]);
    assert.equal(c.versao, '2.00.00');
    assert.ok(c.visto_em);

    await registrar(db, E.conexaoId, [{ tipo: 'status', status: 'conectado', numero: '5565988887777' }]);
    c = await um(db, `SELECT status, numero, pareamento FROM public.bot_conexoes WHERE id = $1`, [E.conexaoId]);
    assert.deepEqual(c, { status: 'conectado', numero: '5565988887777', pareamento: null });
  });

  test('lote com evento ruim: os bons entram, os ruins voltam com o índice', async () => {
    const E = await empresa(db, { email: 'lote@x.com' });
    const r = await registrar(db, E.conexaoId, [
      mensagem({ waId: 'B1' }),
      { tipo: 'desconhecido' },
      'texto solto',
      mensagem({ waId: null }),
      mensagem({ waId: 'B2', chatJid: 'nao-e-jid' }),
      mensagem({ waId: 'B3' }),
    ]);
    assert.equal(r.processados, 2);
    assert.deepEqual(r.erros.map((e) => e.indice), [1, 2, 3, 4]);
    assert.ok(r.erros.every((e) => typeof e.erro === 'string' && e.erro.length > 0));
    assert.equal((await mensagens(db, E.conexaoId)).length, 2);
  });

  test('conexão arquivada não recebe eventos', async () => {
    const E = await empresa(db, { email: 'arquivada@x.com' });
    await db.query(`UPDATE public.bot_conexoes SET arquivado_em = now() WHERE id = $1`, [E.conexaoId]);
    const r = await tentar(db, `SELECT public.bot_registrar_eventos($1, '[]'::jsonb)`, [E.conexaoId]);
    assert.match(r.erro || '', /conexao nao encontrada/);
  });
});

describe('fila de saída', () => {
  let db;
  before(async () => { db = await bancoFase1(); });

  // Conexão com uma conversa individual em que o cliente já escreveu.
  async function cenario(email, opcoes = {}) {
    const E = await empresa(db, { email, botAtivo: true, ...opcoes });
    await registrar(db, E.conexaoId, [mensagem()]);
    const [c] = await conversas(db, E.conexaoId);
    const enfileirar = async (extra = {}) => (await um(db,
      `INSERT INTO public.bot_mensagens (conversa_id, direcao, corpo, status, enviada_por, disparo_id, autor)
       VALUES ($1, 'saida', $2, 'pendente', $3, $4, $5) RETURNING id`,
      [extra.conversaId ?? c.id, extra.corpo ?? 'Oi!', extra.enviadaPor ?? null, extra.disparoId ?? null, extra.autor ?? null])).id;
    return { ...E, conversaId: c.id, enfileirar };
  }

  test('reserva: entrega uma vez, volta só depois de vencer e para em 3 tentativas', async () => {
    const C = await cenario('reserva@x.com');
    const id = await C.enfileirar();
    assert.deepEqual((await reservar(db, C.conexaoId)).map((m) => m.id), [id]);
    assert.deepEqual(await reservar(db, C.conexaoId), [], 'reservada não volta no poll seguinte');

    for (const n of [2, 3]) {
      await db.query(`UPDATE public.bot_mensagens SET reservada_ate = now() - interval '1 second' WHERE id = $1`, [id]);
      assert.deepEqual((await reservar(db, C.conexaoId)).map((m) => m.id), [id], `entrega ${n}`);
    }
    await db.query(`UPDATE public.bot_mensagens SET reservada_ate = now() - interval '1 second' WHERE id = $1`, [id]);
    assert.deepEqual(await reservar(db, C.conexaoId), []);
    const m = await um(db, `SELECT status, erro, tentativas FROM public.bot_mensagens WHERE id = $1`, [id]);
    assert.deepEqual(m, { status: 'erro', erro: 'sem_confirmacao', tentativas: 3 });
  });

  test('agregada do gateway: só conexões gateway, sem campanha, só para quem já escreveu', async () => {
    const C = await cenario('agregada@x.com');
    const PC = await cenario('pc@x.com', { modo: 'pc' });
    const disparo = await um(db, `INSERT INTO public.bot_disparos (escopo, owner_id, nome, mensagem) VALUES ('parceiro', $1, 'Promo', 'oi') RETURNING id`, [C.partnerId]);
    const ok = await C.enfileirar({ autor: 'bot' });
    const campanha = await C.enfileirar({ disparoId: disparo.id });
    const nova = await um(db, `INSERT INTO public.bot_conversas (conexao_id, telefone, estado) VALUES ($1, '556500001111', 'humano') RETURNING id`, [C.conexaoId]);
    const fria = await C.enfileirar({ conversaId: nova.id, enviadaPor: C.profileId });
    const doPc = await PC.enfileirar();

    const lidas = await q(db, `SELECT * FROM public.bot_reservar_fila(NULL, 50)`);
    assert.ok(lidas.some((m) => m.id === ok));
    assert.ok(!lidas.some((m) => [campanha, fria, doPc].includes(m.id)));
    const st = async (id) => um(db, `SELECT status, erro FROM public.bot_mensagens WHERE id = $1`, [id]);
    assert.deepEqual(await st(campanha), { status: 'erro', erro: 'campanha_bloqueada_no_gateway' });
    assert.deepEqual(await st(fria), { status: 'erro', erro: 'contato_nunca_escreveu' });
    assert.deepEqual(await st(doPc), { status: 'pendente', erro: null }, 'a agregada não mexe no PC');

    // no PC (IP do próprio mentorado) a campanha continua saindo
    const campanhaPc = await PC.enfileirar({ disparoId: disparo.id });
    assert.deepEqual((await reservar(db, PC.conexaoId, 10)).map((m) => m.id).sort(), [doPc, campanhaPc].sort());
  });

  test('robô desligado: nada sai, e o pedido vira erro com o motivo', async () => {
    const C = await cenario('desligado@x.com', { botAtivo: false });
    const id = await C.enfileirar({ enviadaPor: C.profileId });
    assert.deepEqual(await reservar(db, C.conexaoId), []);
    assert.deepEqual(await um(db, `SELECT status, erro FROM public.bot_mensagens WHERE id = $1`, [id]), { status: 'erro', erro: 'envio_desligado' });
  });

  test('desconectada: a fila espera sem gastar tentativa', async () => {
    const C = await cenario('pausada@x.com');
    const id = await C.enfileirar();
    await db.query(`UPDATE public.bot_conexoes SET desconectada_em = now() WHERE id = $1`, [C.conexaoId]);
    assert.deepEqual(await reservar(db, C.conexaoId), []);
    assert.deepEqual(await um(db, `SELECT status, tentativas FROM public.bot_mensagens WHERE id = $1`, [id]), { status: 'pendente', tentativas: 0 });
  });

  test('confirmar: idempotente, enviada vence erro, outra conexão não confirma', async () => {
    const C = await cenario('confirma@x.com');
    const outro = await cenario('outro@x.com', { modo: 'pc' });
    const a = await C.enfileirar();
    const b = await C.enfileirar();
    await reservar(db, C.conexaoId);

    assert.equal(await confirmar(db, a, 'enviada', { conexaoId: outro.conexaoId }), 'nao_encontrada');
    assert.equal(await confirmar(db, a, 'enviada', { waId: waIdDaFila(a) }), 'ok', 'gateway: qualquer conexão gateway');
    assert.equal(await confirmar(db, a, 'enviada'), 'ja_confirmada');
    assert.equal(await confirmar(db, a, 'erro', { erro: 'tarde demais' }), 'ja_confirmada');
    const ma = await um(db, `SELECT status, erro, reservada_ate, wa_id FROM public.bot_mensagens WHERE id = $1`, [a]);
    assert.deepEqual(ma, { status: 'enviada', erro: null, reservada_ate: null, wa_id: waIdDaFila(a) });
    const conv = await um(db, `SELECT ultima_saida_em FROM public.bot_conversas WHERE id = $1`, [C.conversaId]);
    assert.equal(conv.ultima_saida_em, null, 'saída do robô não conta como resposta humana');

    assert.equal(await confirmar(db, b, 'erro', { erro: 'whatsapp_desconectado', conexaoId: C.conexaoId }), 'ok');
    assert.equal(await confirmar(db, b, 'erro', { erro: 'de novo', conexaoId: C.conexaoId }), 'ja_confirmada');
    assert.equal(await confirmar(db, b, 'enviada', { conexaoId: C.conexaoId }), 'ok', 'confirmação atrasada de envio vence o erro');
    assert.equal((await um(db, `SELECT status FROM public.bot_mensagens WHERE id = $1`, [b])).status, 'enviada');
    assert.equal(await confirmar(db, '00000000-0000-4000-8000-000000000000', 'enviada'), 'nao_encontrada');
    assert.match((await tentar(db, `SELECT public.bot_confirmar_envio($1, 'talvez')`, [a])).erro || '', /status invalido/);
  });
});

describe('arquivo completo e acesso pelo navegador', () => {
  let db, A, B;
  before(async () => {
    db = await bancoFase1();
    A = await empresa(db, { email: 'arqa@x.com' });
    B = await empresa(db, { email: 'arqb@x.com' });
    await registrar(db, A.conexaoId, [
      { tipo: 'chats_base', chats: [{ jid: `${TEL}@s.whatsapp.net`, telefone: TEL, lid: null, nome: 'João da Agenda', ultimoEm: null }] },
      mensagem({ waId: 'Q1', waEm: '2026-10-06T02:30:00.000Z', anuncio: { titulo: 'Plano trimestral', sourceUrl: 'https://fb.me/abc' } }),
      mensagem({ waId: 'Q2', waEm: '2026-10-06T04:30:00.000Z' }),
      mensagem({ waId: 'Q3', chatJid: '556500002222@s.whatsapp.net', telefone: '556500002222', lid: null, nome: 'Ana', waEm: '2026-10-05T12:00:00.000Z' }),
    ]);
    await registrar(db, B.conexaoId, [mensagem({ waId: 'QB', waEm: '2026-10-05T12:00:00.000Z' })]);
  });

  test('janela do dia: só a empresa pedida, só o que saiu, com anúncio e nome do celular', async () => {
    // 05/10 em Cuiabá (UTC-4) = [05/10 04:00Z, 06/10 04:00Z)
    const { r } = await um(db, `SELECT public.bot_arquivo_completo($1, NULL, '2026-10-05T04:00:00Z', '2026-10-06T04:00:00Z') AS r`, [A.partnerId]);
    assert.deepEqual(r.mensagens.map((m) => m.corpo), ['Oi! Vi o anúncio do plano', 'Oi! Vi o anúncio do plano']);
    assert.equal(r.cortado, false);
    assert.equal(r.conversas.length, 2);
    const joao = r.conversas.find((c) => c.telefone === TEL);
    assert.deepEqual(joao.anuncio, { titulo: 'Plano trimestral', sourceUrl: 'https://fb.me/abc' });
    assert.equal(joao.nome_celular, 'João da Agenda');
    assert.equal(joao.nome, 'João');
    assert.ok(!JSON.stringify(r).includes('QB'));
  });

  test('uma conversa inteira; pendente e erro ficam de fora; corte por limite', async () => {
    const [c] = (await conversas(db, A.conexaoId)).filter((x) => x.telefone === TEL);
    await db.query(`UPDATE public.bot_conexoes SET bot_ativo = true WHERE id = $1`, [A.conexaoId]);
    await db.query(`INSERT INTO public.bot_mensagens (conversa_id, direcao, corpo, status) VALUES ($1, 'saida', 'ainda na fila', 'pendente')`, [c.id]);
    const { r } = await um(db, `SELECT public.bot_arquivo_completo(NULL, $1, NULL, NULL) AS r`, [c.id]);
    assert.equal(r.conversas.length, 1);
    assert.deepEqual(r.mensagens.map((m) => m.momento.slice(0, 16)), ['2026-10-06T02:30', '2026-10-06T04:30']);
    const { r: cortado } = await um(db, `SELECT public.bot_arquivo_completo(NULL, $1, NULL, NULL, 1) AS r`, [c.id]);
    assert.deepEqual([cortado.mensagens.length, cortado.cortado], [1, true]);
  });

  test('o navegador não executa as funções da Fase 1 e só vê a base de contatos da própria empresa', async () => {
    const chamadas = [
      [`SELECT public.bot_registrar_eventos($1, '[]'::jsonb)`, [B.conexaoId]],
      [`SELECT * FROM public.bot_reservar_fila($1, 10)`, [B.conexaoId]],
      [`SELECT public.bot_confirmar_envio('00000000-0000-4000-8000-000000000000', 'enviada')`, []],
      [`SELECT public.bot_arquivo_completo($1, NULL, NULL, NULL)`, [B.partnerId]],
      [`SELECT public.bot_fundir_conversas(gen_random_uuid(), gen_random_uuid())`, []],
      [`SELECT public.bot_wa_id_da_fila(gen_random_uuid())`, []],
    ];
    for (const papel of ['authenticated', 'anon']) {
      await comoPapel(db, papel, papel === 'anon' ? null : A.uid, async () => {
        for (const [sql, args] of chamadas) {
          assert.match((await tentar(db, sql, args)).erro || '', NEGADO, `${papel} executou: ${sql}`);
        }
      });
    }
    await registrar(db, B.conexaoId, [{ tipo: 'chats_base', chats: [{ jid: '556500009999@s.whatsapp.net', telefone: '556500009999' }] }]);
    await comoUsuario(db, A.uid, async () => {
      const r = await tentar(db, `SELECT conexao_id FROM public.wa_contatos_base`);
      assert.ok(r.linhas.length > 0 && r.linhas.every((l) => l.conexao_id === A.conexaoId));
      assert.match((await tentar(db, `INSERT INTO public.wa_contatos_base (conexao_id, jid) VALUES ($1, 'x@lid')`, [A.conexaoId])).erro || '', NEGADO);
      const cx = await tentar(db, `SELECT modo, bot_ativo, opcoes, pareamento, grupos_disponiveis FROM public.bot_conexoes`);
      assert.equal(cx.linhas?.length, 1, cx.erro);
    });
    await comoPapel(db, 'anon', null, async () => {
      assert.match((await tentar(db, `SELECT * FROM public.wa_contatos_base`)).erro || '', NEGADO);
    });
  });
});

describe('achados da revisão da Fase 1', () => {
  let db;
  before(async () => { db = await bancoFase1(); });

  test('o navegador não alimenta a fila: sem entrada falsa, jid, modo, robô nem campanha no gateway', async () => {
    const G = await empresa(db, { email: 'nav-g@x.com', modo: 'gateway', botAtivo: true });
    const PC = await um(db, `INSERT INTO public.bot_conexoes (escopo, owner_id, nome, modo) VALUES ('parceiro', $1, 'PC', 'pc') RETURNING id`, [G.partnerId]);
    const fria = await um(db, `INSERT INTO public.bot_conversas (conexao_id, telefone, estado) VALUES ($1, '5511988887777', 'humano') RETURNING id`, [G.conexaoId]);
    const doPc = await um(db, `INSERT INTO public.bot_conversas (conexao_id, telefone, estado) VALUES ($1, '5511977776666', 'humano') RETURNING id`, [PC.id]);
    const disparo = await um(db, `INSERT INTO public.bot_disparos (escopo, owner_id, nome, mensagem) VALUES ('parceiro', $1, 'Promo', 'oi') RETURNING id`, [G.partnerId]);
    const ins = (conv, direcao, status, colunaExtra) => tentar(db,
      `INSERT INTO public.bot_mensagens (conversa_id, direcao, tipo, corpo, status${colunaExtra ? `, ${colunaExtra[0]}` : ''})
       VALUES ($1, $2, 'texto', 'promo fria', $3${colunaExtra ? `, ${colunaExtra[1]}` : ''})`, [conv, direcao, status]);

    await comoUsuario(db, G.uid, async () => {
      // 1) entrada falsa para liberar "já escreveu"
      assert.match((await ins(fria.id, 'entrada', 'recebida')).erro || '', /so enfileira mensagem de campanha/);
      // 2) saída pendente do "CRM" direto na fila, sem campanha
      assert.match((await ins(fria.id, 'saida', 'pendente')).erro || '', /so enfileira mensagem de campanha/);
      // 3) autor/wa_id não são do navegador
      assert.match((await ins(fria.id, 'saida', 'pendente', ['autor', "'crm'"])).erro || '', NEGADO);
      assert.match((await ins(fria.id, 'saida', 'pendente', ['wa_id', "'X1'"])).erro || '', NEGADO);
      // 4) campanha no gateway: recusada; no PC: entra como campanha
      const camp = (conv) => tentar(db,
        `INSERT INTO public.bot_mensagens (conversa_id, direcao, tipo, corpo, status, disparo_id) VALUES ($1, 'saida', 'texto', 'promo', 'pendente', $2) RETURNING autor`,
        [conv, disparo.id]);
      assert.match((await camp(fria.id)).erro || '', /nao sai pelo gateway/);
      assert.deepEqual((await camp(doPc.id)).linhas, [{ autor: 'campanha' }]);
      // 5) conversa: nada de jid/lid/relógio/conexão; privacidade e estado seguem livres
      for (const col of ["jid = '5511988887777@s.whatsapp.net'", "telefone = '5511900000000'", "lid = '1@lid'", 'ultima_entrada_em = now()', `conexao_id = '${PC.id}'`, "tipo = 'grupo'"]) {
        assert.match((await tentar(db, `UPDATE public.bot_conversas SET ${col} WHERE id = $1`, [fria.id])).erro || '', NEGADO, col);
      }
      assert.equal((await tentar(db, `UPDATE public.bot_conversas SET privacidade = 'so_metadados' WHERE id = $1`, [fria.id])).erro, undefined);
      assert.match((await tentar(db, `INSERT INTO public.bot_conversas (conexao_id, telefone, jid) VALUES ($1, '5511966665555', '5511966665555@s.whatsapp.net')`, [G.conexaoId])).erro || '', NEGADO);
      assert.equal((await tentar(db, `INSERT INTO public.bot_conversas (conexao_id, telefone, estado) VALUES ($1, '5511966665555', 'humano')`, [G.conexaoId])).erro, undefined);
      // 6) conexão: não vira gateway, não liga robô
      assert.match((await tentar(db, `INSERT INTO public.bot_conexoes (escopo, owner_id, nome, modo) VALUES ('parceiro', $1, 'X', 'gateway')`, [G.partnerId])).erro || '', NEGADO);
      assert.match((await tentar(db, `INSERT INTO public.bot_conexoes (escopo, owner_id, nome, bot_ativo) VALUES ('parceiro', $1, 'X', true)`, [G.partnerId])).erro || '', NEGADO);
      for (const col of ["modo = 'pc'", 'bot_ativo = false', "pareamento = '{}'::jsonb", 'desconectada_em = now()', 'arquivado_em = now()']) {
        assert.match((await tentar(db, `UPDATE public.bot_conexoes SET ${col} WHERE id = $1`, [G.conexaoId])).erro || '', NEGADO, col);
      }
      assert.equal((await tentar(db, `UPDATE public.bot_conexoes SET nome = 'Outro nome' WHERE id = $1`, [G.conexaoId])).erro, undefined);
      assert.equal((await tentar(db, `INSERT INTO public.bot_conexoes (escopo, owner_id, nome, limite_diario, status) VALUES ('parceiro', $1, 'Novo PC', 300, 'desconectado')`, [G.partnerId])).erro, undefined);
      // 7) não apaga nem edita mensagem
      assert.match((await tentar(db, `UPDATE public.bot_mensagens SET corpo = 'x'`)).erro || '', NEGADO);
      assert.match((await tentar(db, `DELETE FROM public.bot_mensagens`)).erro || '', NEGADO);
    });

    // nada do que o navegador tentou chega ao gateway
    assert.deepEqual((await q(db, `SELECT * FROM public.bot_reservar_fila(NULL, 50)`)).filter((m) => m.conexao_id === G.conexaoId), []);
    assert.equal((await um(db, `SELECT count(*)::int AS n FROM public.bot_mensagens WHERE conversa_id = $1`, [fria.id])).n, 0);
  });

  test('edição e apagada só valem na conversa do evento e para quem enviou', async () => {
    const E = await empresa(db, { email: 'edicao@x.com' });
    const OUTRO = '5565922220000';
    await registrar(db, E.conexaoId, [
      mensagem({ waId: 'MENTOR1', deMim: true, corpo: 'texto do mentor' }),
      mensagem({ waId: 'CLI1', chatJid: `${OUTRO}@s.whatsapp.net`, telefone: OUTRO, lid: null, corpo: 'original' }),
    ]);
    const lido = async (waId) => um(db, `SELECT corpo, editada_em IS NOT NULL AS editada, apagada_em IS NOT NULL AS apagada
                                           FROM public.bot_mensagens WHERE wa_id = $1`, [waId]);
    const agora = new Date().toISOString();
    const edicao = (extra) => ({ tipo: 'edicao', waId: 'MENTOR1', chatJid: `${TEL}@s.whatsapp.net`, corpo: 'forjado', waEm: agora, ...extra });
    const apagada = (extra) => ({ tipo: 'apagada', waId: 'MENTOR1', chatJid: `${TEL}@s.whatsapp.net`, waEm: agora, ...extra });

    await registrar(db, E.conexaoId, [
      edicao({ chatJid: `${OUTRO}@s.whatsapp.net` }),            // outro chat
      edicao({ deMim: false }),                                  // o cliente "editando" o que o mentor disse
      apagada({ chatJid: `${OUTRO}@s.whatsapp.net` }),
      apagada({ deMim: false }),
    ]);
    assert.deepEqual(await lido('MENTOR1'), { corpo: 'texto do mentor', editada: false, apagada: false });

    await registrar(db, E.conexaoId, [edicao({ deMim: true, corpo: 'texto corrigido' })]);
    assert.deepEqual(await lido('MENTOR1'), { corpo: 'texto corrigido', editada: true, apagada: false });
    await registrar(db, E.conexaoId, [apagada({ deMim: true })]);
    assert.equal((await lido('MENTOR1')).apagada, true);
    // o cliente edita a própria mensagem no chat dele
    await registrar(db, E.conexaoId, [{ tipo: 'edicao', waId: 'CLI1', chatJid: `${OUTRO}@s.whatsapp.net`, deMim: false, corpo: 'corrigido', waEm: agora }]);
    assert.equal((await lido('CLI1')).corpo, 'corrigido');
  });

  test('privacidade marcada à mão também limpa a cópia do texto na linha do tempo do cartão', async () => {
    const E = await empresa(db, { email: 'priv@x.com' });
    await registrar(db, E.conexaoId, [mensagem({ corpo: 'meu cpf é 123' })]);
    const [c] = await conversas(db, E.conexaoId);
    const ativ = () => q(db, `SELECT corpo FROM public.crm_atividades WHERE cartao_id = $1 AND tipo = 'whatsapp' ORDER BY created_at, id`, [c.cartao_id]);
    assert.ok((await ativ()).some((a) => a.corpo === 'Cliente: meu cpf é 123'));
    await db.query(`UPDATE public.bot_conversas SET privacidade = 'so_metadados' WHERE id = $1`, [c.id]);
    assert.deepEqual((await ativ()).filter((a) => /^Cliente:/.test(a.corpo)).map((a) => a.corpo), ['Cliente: [mensagem não registrada]']);
    // depois da marcação, nada de texto novo no cartão
    await registrar(db, E.conexaoId, [mensagem({ waId: 'NOVA1', corpo: 'segredo novo' })]);
    assert.ok(!(await ativ()).some((a) => /segredo novo/.test(a.corpo)));
  });

  test('fusão LID x telefone com a principal em "ignorar" e robô na outra: junta e a marcação vale', async () => {
    const E = await empresa(db, { email: 'fusao@x.com', botAtivo: true });
    const LIDX = '777000111222333@lid';
    await registrar(db, E.conexaoId, [mensagem({ lid: null })]);
    const [porTel] = await conversas(db, E.conexaoId);
    await db.query(`UPDATE public.bot_conversas SET privacidade = 'ignorar' WHERE id = $1`, [porTel.id]);

    // o mesmo contato chega só pelo LID: nasce outra conversa, com o robô
    await registrar(db, E.conexaoId, [mensagem({ waId: 'L1', chatJid: LIDX, telefone: null, lid: LIDX, corpo: 'oi pelo lid' })]);
    const porLid = (await conversas(db, E.conexaoId)).find((c) => c.lid === LIDX);
    assert.ok(porLid);
    await db.query(`INSERT INTO public.bot_mensagens (conversa_id, direcao, corpo, status, autor, enviada_em) VALUES ($1, 'saida', 'menu', 'enviada', 'bot', now())`, [porLid.id]);
    await db.query(`INSERT INTO public.bot_mensagens (conversa_id, direcao, corpo, status, autor) VALUES ($1, 'saida', 'pendente do robô', 'pendente', 'bot')`, [porLid.id]);

    const r = await registrar(db, E.conexaoId, [mensagem({ waId: 'L2', chatJid: LIDX, telefone: TEL, lid: LIDX, corpo: 'agora com telefone' })]);
    assert.deepEqual(r.erros, []);
    const depois = await conversas(db, E.conexaoId);
    assert.equal(depois.length, 1);
    assert.equal(depois[0].privacidade, 'ignorar');
    assert.equal(depois[0].lid, LIDX);
    const ms = await mensagens(db, E.conexaoId);
    assert.ok(ms.every((m) => m.corpo === null), 'o texto das duas sai');
    assert.deepEqual(ms.filter((m) => m.status === 'pendente'), [], 'nada automático fica na fila de quem é "ignorar"');
  });

  test('fusão leva o passo do fluxo da conversa absorvida', async () => {
    const E = await empresa(db, { email: 'fluxo@x.com', botAtivo: true });
    const LIDX = '888000111222333@lid';
    await registrar(db, E.conexaoId, [mensagem({ lid: null, origemEvento: 'offline' })]);
    const [porTel] = await conversas(db, E.conexaoId);
    await registrar(db, E.conexaoId, [mensagem({ waId: 'F1', chatJid: LIDX, telefone: null, lid: LIDX })]);
    const porLid = (await conversas(db, E.conexaoId)).find((c) => c.lid === LIDX);
    const flx = await um(db, `SELECT id FROM public.bot_fluxos WHERE owner_id = $1 LIMIT 1`, [E.partnerId]);
    const passo = await um(db, `SELECT id FROM public.bot_passos WHERE fluxo_id = $1 ORDER BY posicao LIMIT 1`, [flx.id]);
    await db.query(`UPDATE public.bot_conversas SET fluxo_id = $2, passo_atual_id = $3, tentativas_passo = 1, estado = 'bot' WHERE id = $1`, [porLid.id, flx.id, passo.id]);
    await db.query(`UPDATE public.bot_conversas SET estado = 'bot' WHERE id = $1`, [porTel.id]);

    await registrar(db, E.conexaoId, [mensagem({ waId: 'F2', chatJid: LIDX, telefone: TEL, lid: LIDX, origemEvento: 'offline' })]);
    const [c] = await conversas(db, E.conexaoId);
    assert.deepEqual({ f: c.fluxo_id, p: c.passo_atual_id, t: c.tentativas_passo }, { f: flx.id, p: passo.id, t: 1 });
  });

  test('robô não responde a reação, figurinha, enquete nem texto vazio', async () => {
    const E = await empresa(db, { email: 'reacao@x.com', botAtivo: true });
    let n = 0;
    const ev = (extra) => mensagem({ waId: `R${++n}`, ...extra });
    const r = await registrar(db, E.conexaoId, [
      ev({ tipoMidia: 'reacao', corpo: '👍' }),
      ev({ tipoMidia: 'figurinha', corpo: null }),
      ev({ tipoMidia: 'enquete', corpo: 'Qual?' }),
      ev({ tipoMidia: 'texto', corpo: null }),
    ]);
    assert.deepEqual(r.responder, []);
    const ok = await registrar(db, E.conexaoId, [ev({ corpo: '1' })]);
    assert.equal(ok.responder.length, 1);
  });

  test('fila: conexão bloqueada espera e o limite do dia segura o excedente', async () => {
    const E = await empresa(db, { email: 'saldo@x.com', botAtivo: true });
    await registrar(db, E.conexaoId, [mensagem()]);
    const [c] = await conversas(db, E.conexaoId);
    const ids = [];
    for (const t of ['a', 'b', 'c']) {
      ids.push((await um(db, `INSERT INTO public.bot_mensagens (conversa_id, direcao, corpo, status, autor) VALUES ($1, 'saida', $2, 'pendente', 'bot') RETURNING id`, [c.id, t])).id);
    }
    await db.query(`UPDATE public.bot_conexoes SET bloqueado_em = now() WHERE id = $1`, [E.conexaoId]);
    assert.deepEqual(await reservar(db, E.conexaoId), []);
    assert.equal((await um(db, `SELECT count(*)::int AS n FROM public.bot_mensagens WHERE id = ANY($1) AND status = 'pendente'`, [ids])).n, 3);

    await db.query(`UPDATE public.bot_conexoes SET bloqueado_em = NULL, limite_diario = 2 WHERE id = $1`, [E.conexaoId]);
    assert.equal((await reservar(db, E.conexaoId)).length, 2);
    assert.equal((await reservar(db, E.conexaoId)).length, 0, 'o saldo conta o que está reservado');
    assert.equal((await um(db, `SELECT count(*)::int AS n FROM public.bot_mensagens WHERE id = ANY($1) AND status = 'pendente' AND reservada_ate IS NULL`, [ids])).n, 1, 'a terceira fica para amanhã');
  });

  test('campanha cancelada não sai', async () => {
    const E = await empresa(db, { email: 'cancelada@x.com', modo: 'pc', botAtivo: true });
    await registrar(db, E.conexaoId, [mensagem()]);
    const [c] = await conversas(db, E.conexaoId);
    const d = await um(db, `INSERT INTO public.bot_disparos (escopo, owner_id, nome, mensagem, status) VALUES ('parceiro', $1, 'P', 'oi', 'cancelado') RETURNING id`, [E.partnerId]);
    const m = await um(db, `INSERT INTO public.bot_mensagens (conversa_id, direcao, corpo, status, disparo_id) VALUES ($1, 'saida', 'promo', 'pendente', $2) RETURNING id`, [c.id, d.id]);
    assert.deepEqual(await reservar(db, E.conexaoId), []);
    assert.deepEqual(await um(db, `SELECT status, erro FROM public.bot_mensagens WHERE id = $1`, [m.id]), { status: 'erro', erro: 'campanha_cancelada' });
  });
});
