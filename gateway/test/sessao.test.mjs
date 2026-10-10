// Sessao com um socket FALSO (EventEmitter no lugar do Baileys) e um transporte falso.
// Nada aqui abre conexão com o WhatsApp nem com o CRM.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, mkdir, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sessao, normalizarOpcoes } from '../sessao.mjs';
import { waIdDaFila } from '../mapear.mjs';

const AGORA = Date.parse('2026-10-07T15:00:00.000Z');
const CLIENTE = '5565999990000@s.whatsapp.net';
const GRUPO = '120363000000000001@g.us';
const pastas = [];
after(async () => { for (const p of pastas) await rm(p, { recursive: true, force: true }); });

const tique = () => new Promise((r) => setImmediate(r));

class SocketFalso {
  constructor(relogio) {
    this.relogio = relogio;
    this.ev = new EventEmitter();
    this.user = { id: '5565988887777:12@s.whatsapp.net', lid: '99999999999:12@lid' };
    this.enviadas = [];
    this.presencas = [];
    this.encerrado = false;
    this.codigoPedidoPara = null;
    this.grupos = { [GRUPO]: { id: GRUPO, subject: 'Alunos', participants: [{ id: 'a' }, { id: 'b' }] } };
    this.leuMensagens = false;
  }
  async sendMessage(jid, conteudo, opcoes = {}) {
    this.enviadas.push({ jid, conteudo, opcoes, em: this.relogio.t });
    const r = { key: { remoteJid: jid, fromMe: true, id: opcoes.messageId }, message: { conversation: conteudo.text }, messageTimestamp: Math.floor(this.relogio.t / 1000) };
    // Como o Baileys com emitOwnEvents: o próprio envio volta como upsert 'append'.
    process.nextTick(() => this.ev.emit('messages.upsert', { messages: [r], type: 'append' }));
    return r;
  }
  async sendPresenceUpdate(tipo) { this.presencas.push(tipo); }
  async groupFetchAllParticipating() { return this.grupos; }
  async requestPairingCode(telefone) { this.codigoPedidoPara = telefone; return 'ABCD1234'; }
  async readMessages() { this.leuMensagens = true; throw new Error('readMessages nunca pode ser chamado'); }
  async logout() { this.saiu = true; this.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } }); }
  end() { this.encerrado = true; }
  abrir() { this.ev.emit('connection.update', { connection: 'open' }); }
  fechar(statusCode) { this.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode } } } }); }
  receber(messages, type = 'notify') { this.ev.emit('messages.upsert', { messages, type }); }
}

function transporteFalso() {
  const t = {
    chamadas: [],
    confirmacoes: [],
    fora: false,
    recusarPorIndice: null,   // (eventos) => [{indice, erro}]
    recusar400: null,         // (eventos) => boolean
    async eventos(_conexaoId, eventos) {
      if (t.fora) throw new Error('fetch failed');
      if (t.recusar400?.(eventos)) { const e = new Error('HTTP 400: formato'); e.httpStatus = 400; throw e; }
      t.chamadas.push(structuredClone(eventos));
      return { ok: true, processados: eventos.length, erros: t.recusarPorIndice ? t.recusarPorIndice(eventos) : [] };
    },
    async confirmar(d) { t.confirmacoes.push(d); return { ok: true }; },
    get todos() { return t.chamadas.flat(); },
    mensagens() { return t.chamadas.flat().filter((e) => e.tipo === 'mensagem'); },
  };
  return t;
}

async function montar({ opcoes = {}, pareado = true, pareamento = null, transporte = transporteFalso(), pasta = null, agendarReal = false, esperarReal = false } = {}) {
  if (!pasta) { pasta = await mkdtemp(join(tmpdir(), 'sessao-')); pastas.push(pasta); }
  const relogio = { t: AGORA };
  const sockets = [];
  const timers = [];
  const esperas = [];
  const amb = {
    pasta,
    criarSocket: async () => { const sock = new SocketFalso(relogio); sockets.push(sock); return { sock }; },
    estaPareado: async () => (typeof pareado === 'function' ? pareado() : pareado),
    agora: () => relogio.t,
    esperar: esperarReal ? (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 200))) : async (ms) => { esperas.push(ms); relogio.t += ms; },
    log: () => {},
    aleatorio: () => 0,
  };
  if (!agendarReal) {
    amb.agendar = (fn, ms) => { const h = { fn, ms }; timers.push(h); return h; };
    amb.cancelar = (h) => { if (h) h.cancelado = true; };
  }
  const s = new Sessao('cx-1', opcoes, transporte, amb);
  await s.iniciar({ pareamento });
  return { s, t: transporte, sock: () => sockets.at(-1), sockets, relogio, timers, esperas, pasta };
}

const msg = (id, texto, extra = {}) => ({
  key: { remoteJid: CLIENTE, fromMe: false, id, ...(extra.key || {}) },
  messageTimestamp: Math.floor(AGORA / 1000) - 5,
  pushName: 'João',
  message: { conversation: texto },
  ...extra.resto,
});

async function aberta(cenario) {
  cenario.sock().abrir();
  await tique();
  await cenario.s.descarregarAgora();
  cenario.t.chamadas.length = 0;
}

test('lote: até 50 eventos por chamada, na ordem em que chegaram', async () => {
  const c = await montar();
  await aberta(c);
  const ids = Array.from({ length: 120 }, (_, i) => `3EB0${String(i).padStart(4, '0')}`);
  c.sock().receber(ids.map((id) => msg(id, `m ${id}`)));
  await c.s.descarregarAgora();
  assert.deepEqual(c.t.chamadas.map((l) => l.length), [50, 50, 20]);
  assert.deepEqual(c.t.mensagens().map((e) => e.waId), ids);
  assert.equal(c.s.spool.tamanho, 0);
});

test('lote: evento solto sobe sozinho em cerca de 1 s', async () => {
  const c = await montar({ agendarReal: true });
  c.sock().receber([msg('3EB0SOLTO', 'oi')]);
  assert.equal(c.t.mensagens().length, 0);
  await new Promise((r) => setTimeout(r, 1300));
  assert.deepEqual(c.t.mensagens().map((e) => e.waId), ['3EB0SOLTO']);
  await c.s.parar();
});

test('spool: com a nuvem fora os eventos vão para o disco e sobem quando ela volta, mesmo depois de reiniciar', async () => {
  const t = transporteFalso();
  const c = await montar({ transporte: t });
  await aberta(c);
  t.fora = true;
  c.sock().receber([msg('3EB0A1', 'um'), msg('3EB0A2', 'dois'), msg('3EB0A3', 'três')]);
  await c.s.descarregarAgora();
  await c.s.spool.gravado();
  const disco = await readFile(join(c.pasta, 'pendentes.jsonl'), 'utf8');
  for (const id of ['3EB0A1', '3EB0A2', '3EB0A3']) assert.ok(disco.includes(id), id);
  assert.equal(t.mensagens().length, 0);

  // Novos eventos com a nuvem fora não disparam chamada nenhuma: o retry agendado é que tenta.
  const antes = t.chamadas.length;
  c.sock().receber([msg('3EB0A4', 'quatro')]);
  await tique();
  assert.equal(t.chamadas.length, antes);
  await c.s.parar();

  // Reinício do processo: outra Sessao, mesma pasta.
  t.fora = false;
  const t2 = transporteFalso();
  const c2 = await montar({ transporte: t2, pasta: c.pasta });
  await c2.s.descarregarAgora();
  assert.deepEqual(t2.mensagens().map((e) => e.waId), ['3EB0A1', '3EB0A2', '3EB0A3', '3EB0A4']);
  await c2.s.spool.gravado();
  await assert.rejects(stat(join(c.pasta, 'pendentes.jsonl')), { code: 'ENOENT' });
});

test('evento recusado por índice sai do spool e não trava os seguintes', async () => {
  const t = transporteFalso();
  t.recusarPorIndice = (evs) => evs.map((e, indice) => (e.waId === '3EB0RUIM' ? { indice, erro: 'conversa_invalida' } : null)).filter(Boolean);
  const c = await montar({ transporte: t });
  await aberta(c);
  c.sock().receber([msg('3EB0OK1', 'a'), msg('3EB0RUIM', 'b'), msg('3EB0OK2', 'c')]);
  await c.s.descarregarAgora();
  assert.equal(c.s.spool.tamanho, 0);
  c.sock().receber([msg('3EB0OK3', 'd')]);
  await c.s.descarregarAgora();
  assert.deepEqual(t.mensagens().map((e) => e.waId), ['3EB0OK1', '3EB0RUIM', '3EB0OK2', '3EB0OK3']);
  const rejeitados = await readFile(join(c.pasta, 'rejeitados.jsonl'), 'utf8');
  assert.ok(rejeitados.includes('3EB0RUIM') && rejeitados.includes('conversa_invalida'));
});

test('lote recusado inteiro (400) é dividido até isolar o evento ruim; os bons sobem', async () => {
  const t = transporteFalso();
  t.recusar400 = (evs) => evs.some((e) => e.waId === '3EB0VENENO');
  const c = await montar({ transporte: t });
  await aberta(c);
  const ids = Array.from({ length: 10 }, (_, i) => (i === 6 ? '3EB0VENENO' : `3EB0B${i}`));
  c.sock().receber(ids.map((id) => msg(id, id)));
  await c.s.descarregarAgora();
  assert.deepEqual(t.mensagens().map((e) => e.waId), ids.filter((id) => id !== '3EB0VENENO'));
  assert.equal(c.s.spool.tamanho, 0);
  assert.ok((await readFile(join(c.pasta, 'rejeitados.jsonl'), 'utf8')).includes('3EB0VENENO'));
});

test('eco do envio da fila não volta como mensagem do mentorado, e a mesma mensagem não sai duas vezes', async () => {
  const c = await montar({ opcoes: { botAtivo: true } });
  await aberta(c);
  await c.s.enfileirarEnvio([{ id: 'fila-1', conexaoId: 'cx-1', para: CLIENTE, corpo: 'Olá! Tudo bem?', tipo: 'texto' }]);
  await tique();
  const waId = waIdDaFila('fila-1');
  assert.equal(c.sock().enviadas.length, 1);
  assert.equal(c.sock().enviadas[0].opcoes.messageId, waId);
  assert.deepEqual(c.sock().presencas, ['composing', 'paused']);
  assert.deepEqual(c.t.confirmacoes, [{ id: 'fila-1', status: 'enviada', waId }]);

  // O mentorado responde pelo celular: isso sim é deMim.
  c.sock().receber([msg('3EB0CELULAR', 'mandei do celular', { key: { fromMe: true } })]);
  await c.s.descarregarAgora();
  const msgs = c.t.mensagens();
  assert.deepEqual(msgs.map((e) => [e.waId, e.deMim]), [['3EB0CELULAR', true]]);

  // O CRM devolve a mesma mensagem (confirmação perdida): confirma de novo, não envia.
  await c.s.enfileirarEnvio([{ id: 'fila-1', conexaoId: 'cx-1', para: CLIENTE, corpo: 'Olá! Tudo bem?', tipo: 'texto' }]);
  assert.equal(c.sock().enviadas.length, 1);
  assert.deepEqual(c.t.confirmacoes.at(-1), { id: 'fila-1', status: 'enviada', waId });

  // Depois de reiniciar o processo, o eco que chegar atrasado ainda é reconhecido.
  await c.s.parar();
  const c2 = await montar({ pasta: c.pasta, opcoes: { botAtivo: true } });
  await aberta(c2);
  c2.sock().receber([{ key: { remoteJid: CLIENTE, fromMe: true, id: waId }, messageTimestamp: Math.floor(AGORA / 1000), message: { conversation: 'Olá! Tudo bem?' } }], 'append');
  await c2.s.descarregarAgora();
  assert.equal(c2.t.mensagens().length, 0);
  assert.equal(c.sock().leuMensagens, false);
});

test('no máximo 1 envio a cada 8 s por número, com "digitando" antes', async () => {
  const c = await montar({ opcoes: { botAtivo: true } });
  await aberta(c);
  await c.s.enfileirarEnvio(['a', 'b', 'c'].map((x) => ({ id: `fila-${x}`, para: CLIENTE, corpo: `mensagem ${x}`, tipo: 'texto' })));
  const ems = c.sock().enviadas.map((e) => e.em);
  assert.equal(ems.length, 3);
  for (let i = 1; i < ems.length; i++) assert.ok(ems[i] - ems[i - 1] >= 8000, `intervalo ${ems[i] - ems[i - 1]}`);
  assert.ok(c.esperas.includes(1200), 'digitando mínimo de 1,2 s');
});

test('robô desligado (padrão): nada sai e a fila volta com erro', async () => {
  const c = await montar();
  await aberta(c);
  assert.equal(c.s.opcoes.botAtivo, false);
  await c.s.enfileirarEnvio([{ id: 'fila-x', para: CLIENTE, corpo: 'oi', tipo: 'texto' }]);
  assert.equal(c.sock().enviadas.length, 0);
  assert.equal(c.t.confirmacoes[0].status, 'erro');
  assert.match(c.t.confirmacoes[0].erro, /envio_desligado/);
});

test('fila nunca manda para grupo nem tipo que não seja texto', async () => {
  const c = await montar({ opcoes: { botAtivo: true } });
  await aberta(c);
  await c.s.enfileirarEnvio([
    { id: 'g', para: GRUPO, corpo: 'oi grupo', tipo: 'texto' },
    { id: 'i', para: CLIENTE, corpo: 'x', tipo: 'imagem' },
  ]);
  assert.equal(c.sock().enviadas.length, 0);
  assert.deepEqual(c.t.confirmacoes.map((x) => [x.id, x.status]), [['g', 'erro'], ['i', 'erro']]);
});

test('grupo não permitido não sai; depois de marcado, sai', async () => {
  const c = await montar();
  await aberta(c);
  const doGrupo = (id) => ({ key: { remoteJid: GRUPO, fromMe: false, id, participant: CLIENTE }, messageTimestamp: Math.floor(AGORA / 1000), pushName: 'Maria', message: { conversation: 'bom dia' } });
  c.sock().receber([doGrupo('3EB0G1')]);
  await c.s.descarregarAgora();
  assert.equal(c.t.mensagens().length, 0);
  c.s.atualizarOpcoes({ gruposPermitidos: [GRUPO] });
  c.sock().receber([doGrupo('3EB0G2')]);
  await c.s.descarregarAgora();
  const [ev] = c.t.mensagens();
  assert.equal(ev.waId, '3EB0G2');
  assert.equal(ev.grupoNome, 'Alunos');
  assert.equal(ev.participanteTelefone, '5565999990000');
});

test('append (chegou com a sessão fora do ar) vira offline com a hora do WhatsApp', async () => {
  const c = await montar();
  await aberta(c);
  const ts = Math.floor(AGORA / 1000) - 900;
  c.sock().receber([msg('3EB0OFF', 'mandei enquanto você estava fora', { resto: { messageTimestamp: ts } })], 'append');
  await c.s.descarregarAgora();
  const [ev] = c.t.mensagens();
  assert.equal(ev.origemEvento, 'offline');
  assert.equal(ev.waEm, new Date(ts * 1000).toISOString());
});

test('recibo que o Baileys fundiu na mensagem do lote offline sobe logo depois dela', async () => {
  const c = await montar();
  await aberta(c);
  const ts = Math.floor(AGORA / 1000) - 600;
  c.sock().receber([
    { key: { remoteJid: CLIENTE, fromMe: true, id: '3EB0LIDA' }, messageTimestamp: ts, status: 4, message: { conversation: 'mandei do celular com o gateway fora' } },
  ], 'append');
  await c.s.descarregarAgora();
  assert.deepEqual(c.t.todos.map((e) => [e.tipo, e.waId, e.status ?? e.origemEvento]), [['mensagem', '3EB0LIDA', 'offline'], ['recibo', '3EB0LIDA', 'lida']]);
});

test('fila que chega com a sessão parada volta na hora (a reserva não fica presa)', async () => {
  const c = await montar({ opcoes: { botAtivo: true } });
  await aberta(c);
  await c.s.parar();
  c.t.confirmacoes.length = 0;
  await c.s.enfileirarEnvio([{ id: 'fila-tarde', para: CLIENTE, corpo: 'oi', tipo: 'texto' }]);
  await tique();
  assert.deepEqual(c.t.confirmacoes, [{ id: 'fila-tarde', status: 'erro', erro: 'sessao_parada' }]);
  assert.equal(c.sock().enviadas.length, 0);
});

test('nenhum arquivo do gateway marca como lida nem fica "online"', async () => {
  for (const arq of ['sessao.mjs', 'mapear.mjs', 'filho.mjs', 'gateway.mjs', 'supervisor.mjs', 'pc.mjs', 'nuvem.mjs']) {
    const codigo = (await readFile(new URL(`../${arq}`, import.meta.url), 'utf8')).replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
    assert.doesNotMatch(codigo, /readMessages\s*\(|sendReceipts?\s*\(|chatModify\s*\(|'available'/, arq);
  }
});

test('ao conectar: status conectado com o número e a lista de grupos', async () => {
  const c = await montar();
  c.sock().abrir();
  await tique();
  await c.s.descarregarAgora();
  const status = c.t.todos.filter((e) => e.tipo === 'status');
  assert.deepEqual(status.map((e) => e.status), ['conectando', 'conectado']);
  assert.equal(status[1].numero, '5565988887777');
  const grupos = c.t.todos.find((e) => e.tipo === 'grupos');
  assert.deepEqual(grupos.grupos, [{ jid: GRUPO, nome: 'Alunos', participantes: 2 }]);
});

test('histórico do pareamento: só os dias pedidos, como historico, e a lista de conversas sem corpo', async () => {
  const c = await montar({ opcoes: { historicoDias: 7 } });
  await aberta(c);
  const s = Math.floor(AGORA / 1000);
  c.sock().ev.emit('messaging-history.set', {
    chats: [{ id: CLIENTE, name: 'João', conversationTimestamp: s - 3600 }, { id: '5511900000000@s.whatsapp.net', conversationTimestamp: s - 86400 * 200 }],
    contacts: [{ id: CLIENTE, lid: '123@lid' }],
    messages: [
      { key: { remoteJid: CLIENTE, fromMe: false, id: 'H1' }, messageTimestamp: { toNumber: () => s - 86400 * 2 }, message: { conversation: 'de 2 dias atrás' } },
      { key: { remoteJid: CLIENTE, fromMe: true, id: 'H2' }, messageTimestamp: s - 86400 * 10, message: { conversation: 'de 10 dias atrás' } },
    ],
    syncType: 0,
  });
  await c.s.descarregarAgora();
  const msgs = c.t.mensagens();
  assert.deepEqual(msgs.map((e) => [e.waId, e.origemEvento, e.lid]), [['H1', 'historico', '123@lid']]);
  const base = c.t.todos.filter((e) => e.tipo === 'chats_base');
  assert.equal(base.length, 1);
  assert.deepEqual(base[0].chats.map((x) => x.jid), [CLIENTE, '5511900000000@s.whatsapp.net']);
  assert.ok(!JSON.stringify(base).includes('dias atrás'));
});

test('histórico com historicoDias 0: só a lista de conversas', async () => {
  const c = await montar({ opcoes: { historicoDias: 0 } });
  await aberta(c);
  c.sock().ev.emit('messaging-history.set', {
    chats: [{ id: CLIENTE }],
    messages: [{ key: { remoteJid: CLIENTE, fromMe: false, id: 'H1' }, messageTimestamp: Math.floor(AGORA / 1000) - 60, message: { conversation: 'x' } }],
  });
  await c.s.descarregarAgora();
  assert.equal(c.t.mensagens().length, 0);
  assert.equal(c.t.todos.filter((e) => e.tipo === 'chats_base').length, 1);
});

test('pareamento por código: pede o código ao WhatsApp com DDI e manda codigo_pareamento', async () => {
  const c = await montar({ pareado: false, pareamento: { metodo: 'codigo', telefone: '(65) 98888-7777' } });
  c.sock().ev.emit('connection.update', { qr: 'ref-do-qr' });
  await tique();
  await c.s.descarregarAgora();
  assert.equal(c.sock().codigoPedidoPara, '5565988887777');
  assert.ok(c.t.todos.some((e) => e.tipo === 'codigo_pareamento' && e.codigo === 'ABCD1234'));
  assert.ok(!c.t.todos.some((e) => e.tipo === 'qr'), 'no caminho do código o QR não sobe');
  assert.equal(c.s.estado.conexao, 'aguardando_codigo');
});

test('pareamento por QR: cada QR sobe como evento qr (que não vai para o disco)', async () => {
  const c = await montar({ pareado: false, pareamento: { metodo: 'qr' } });
  c.sock().ev.emit('connection.update', { qr: 'qr-1' });
  await tique();
  c.sock().ev.emit('connection.update', { qr: 'qr-2' });
  await tique();
  await c.s.descarregarAgora();
  assert.deepEqual(c.t.todos.filter((e) => e.tipo === 'qr').map((e) => e.qr), ['qr-1', 'qr-2']);
  await c.s.spool.gravado();
  const disco = await readFile(join(c.pasta, 'pendentes.jsonl'), 'utf8').catch(() => '');
  assert.ok(!disco.includes('qr-1'));
});

test('sem sessão salva e sem pedido de pareamento: nem abre o socket', async () => {
  let fim = null;
  const pasta = await mkdtemp(join(tmpdir(), 'sessao-')); pastas.push(pasta);
  let criados = 0;
  const s = new Sessao('cx-1', {}, transporteFalso(), {
    pasta, estaPareado: async () => false, criarSocket: async () => { criados++; return { sock: new SocketFalso({ t: AGORA }) }; },
    log: () => {}, agendar: () => ({}), cancelar: () => {},
  });
  s.on('fim', (f) => { fim = f; });
  await s.iniciar();
  assert.equal(criados, 0);
  assert.deepEqual(fim, { motivo: 'precisa_parear' });
});

test('deslogado pelo celular: avisa, apaga as credenciais e para', async () => {
  const c = await montar();
  await aberta(c);
  await mkdir(join(c.pasta, 'auth'), { recursive: true });
  await writeFile(join(c.pasta, 'auth', 'creds.json'), '{}');
  const fim = new Promise((r) => c.s.once('fim', r));
  c.sock().fechar(401);
  assert.deepEqual(await fim, { motivo: 'deslogado' });
  await c.s.descarregarAgora();
  assert.ok(c.t.todos.some((e) => e.tipo === 'status' && e.status === 'deslogado'));
  await assert.rejects(stat(join(c.pasta, 'auth')), { code: 'ENOENT' });
});

test('queda comum: avisa desconectado e religa com espera', async () => {
  const c = await montar();
  await aberta(c);
  c.sock().fechar(428);
  await tique();
  await c.s.descarregarAgora();
  assert.ok(c.t.todos.some((e) => e.tipo === 'status' && e.status === 'desconectado'));
  const religar = c.timers.filter((h) => !h.cancelado && h.ms >= 2000 && h.ms <= 10_000);
  assert.ok(religar.length >= 1);
  const antes = c.sockets.length;
  for (const h of religar) h.fn();
  await tique();
  assert.equal(c.sockets.length, antes + 1);
});

test('desconectar: sai do aparelho e apaga a pasta da sessão', async () => {
  const c = await montar();
  await aberta(c);
  let fim = null;
  c.s.on('fim', (f) => { fim = f; });
  await c.s.desconectar();
  assert.deepEqual(fim, { motivo: 'desconectada' });
  assert.ok(c.t.todos.some((e) => e.tipo === 'status' && e.status === 'deslogado'));
  await assert.rejects(stat(c.pasta), { code: 'ENOENT' });
  // No modo PC a mesma Sessao pode parear de novo em seguida.
  assert.equal(c.s.pareado, false);
  const antes = c.sockets.length;
  await c.s.parear({ metodo: 'qr' });
  assert.equal(c.sockets.length, antes + 1);
});

test('desconectar sessão pareada que estava fora do ar: liga só para sair do aparelho, depois apaga', async () => {
  const c = await montar({ esperarReal: true });
  assert.equal(c.s.estado.conexao, 'conectando');
  setTimeout(() => c.sock().abrir(), 20);
  await c.s.desconectar();
  assert.equal(c.sock().saiu, true, 'logout chamado no socket aberto');
  await assert.rejects(stat(c.pasta), { code: 'ENOENT' });
});

test('desconectar: enquanto liga só para sair do aparelho, nada da fila é enviado', async () => {
  const c = await montar({ esperarReal: true, opcoes: { botAtivo: true } });
  const fim = c.s.desconectar();
  await tique();
  await c.s.enfileirarEnvio([{ id: 'fila-no-meio', para: CLIENTE, corpo: 'oi', tipo: 'texto' }]);
  c.sock().abrir();
  await fim;
  assert.equal(c.sock().saiu, true);
  assert.deepEqual(c.sockets.flatMap((s) => s.enviadas), []);
  assert.deepEqual(c.t.confirmacoes, [{ id: 'fila-no-meio', status: 'erro', erro: 'sessao_parada' }]);
});

test('desconectar quando o WhatsApp já encerrou a sessão (401 ao religar): apaga do mesmo jeito', async () => {
  const c = await montar({ esperarReal: true });
  const fins = [];
  c.s.on('fim', (f) => fins.push(f.motivo));
  setTimeout(() => c.sock().fechar(401), 20);
  await c.s.desconectar();
  assert.deepEqual(fins, ['deslogado', 'desconectada']);
  await assert.rejects(stat(c.pasta), { code: 'ENOENT' });
});

test('normalizarOpcoes: padrões do contrato e limites', () => {
  assert.deepEqual(normalizarOpcoes({}), { gruposPermitidos: [], historicoDias: 7, botAtivo: false });
  assert.deepEqual(normalizarOpcoes({ gruposPermitidos: [GRUPO, GRUPO, CLIENTE], historicoDias: 99, botAtivo: 'true' }), { gruposPermitidos: [GRUPO], historicoDias: 30, botAtivo: false });
  assert.equal(normalizarOpcoes({ historicoDias: 0 }).historicoDias, 0);
});
