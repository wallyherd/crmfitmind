// Comprovantes (tarefa Q1): o que o gateway baixa, o teto de 4 MB, os tipos aceitos, grupo e mentorado ignorados,
// a fila em disco quando o CRM está fora e o envio com HMAC sobre os bytes. Download, WhatsApp e CRM são falsos.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createHmac, createHash } from 'node:crypto';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sessao } from '../sessao.mjs';
import { FilaMidia, MAX_BYTES, avaliarMidia, baixarMidiaBaileys, mimetypeDe } from '../midias.mjs';
import { assinar, criarTransporteGateway, criarTransportePC } from '../nuvem.mjs';

const AGORA = Date.parse('2026-10-07T15:00:00.000Z');
const CLIENTE = '5565999990000@s.whatsapp.net';
const CLIENTE_LID = '103843987759126@lid';
const GRUPO = '120363000000000001@g.us';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('pix R$ 497,00')]);
const PDF = Buffer.from('%PDF-1.4 comprovante');
const pastas = [];
after(async () => { for (const p of pastas) await rm(p, { recursive: true, force: true }); });
const tique = () => new Promise((r) => setImmediate(r));

/* ---------------- avaliarMidia: a regra de quem vale baixar ---------------- */

const evImagem = (extra = {}) => ({
  tipo: 'mensagem', waId: 'W1', chatJid: CLIENTE, grupo: false, deMim: false, tipoMidia: 'imagem',
  origemEvento: 'tempo_real', midia: { mimetype: 'image/jpeg', tamanho: 120_000 }, ...extra,
});

test('avaliarMidia: imagem e PDF do cliente em conversa individual valem; o resto não', () => {
  assert.deepEqual(avaliarMidia(evImagem()), { baixar: true, mimetype: 'image/jpeg' });
  assert.deepEqual(avaliarMidia(evImagem({ tipoMidia: 'documento', midia: { mimetype: 'application/pdf' } })), { baixar: true, mimetype: 'application/pdf' });
  assert.deepEqual(avaliarMidia(evImagem({ chatJid: CLIENTE_LID })), { baixar: true, mimetype: 'image/jpeg' }, 'conversa por LID também é individual');
  assert.deepEqual(avaliarMidia(evImagem({ origemEvento: 'offline' })), { baixar: true, mimetype: 'image/jpeg' });
  assert.deepEqual(avaliarMidia(evImagem({ midia: { mimetype: 'IMAGE/PNG; x=1' } })), { baixar: true, mimetype: 'image/png' });
});

test('avaliarMidia: grupo, o que o mentorado manda, outros tipos, histórico, visualização única e mimetype fora da lista', () => {
  const motivo = (ev) => avaliarMidia(ev).motivo;
  assert.equal(motivo(evImagem({ grupo: true, chatJid: GRUPO })), 'grupo');
  assert.equal(motivo(evImagem({ chatJid: GRUPO })), 'grupo', 'jid de grupo mesmo com grupo:false');
  assert.equal(motivo(evImagem({ deMim: true })), 'de_mim');
  for (const t of ['audio', 'video', 'figurinha', 'texto', 'localizacao', 'contato', 'outro']) assert.equal(motivo(evImagem({ tipoMidia: t })), 'tipo', t);
  assert.equal(motivo(evImagem({ origemEvento: 'historico' })), 'historico');
  assert.equal(motivo(evImagem({ midia: { mimetype: 'image/jpeg', visualizacaoUnica: true } })), 'visualizacao_unica');
  for (const m of ['image/gif', 'image/svg+xml', 'image/heic', 'application/zip', 'application/msword', 'text/html', 'video/mp4', undefined]) {
    assert.equal(motivo(evImagem({ midia: { mimetype: m } })), 'mimetype', String(m));
  }
  assert.equal(motivo(evImagem({ midia: null })), 'mimetype');
  assert.equal(motivo({ tipo: 'recibo' }), 'nao_e_mensagem');
  assert.equal(motivo(null), 'nao_e_mensagem');
});

test('avaliarMidia: o limite é 4 MB (4 MB cheios passam, um byte a mais vira só metadado)', () => {
  assert.equal(MAX_BYTES, 4 * 1024 * 1024);
  assert.equal(avaliarMidia(evImagem({ midia: { mimetype: 'image/jpeg', tamanho: MAX_BYTES } })).baixar, true);
  assert.equal(avaliarMidia(evImagem({ midia: { mimetype: 'image/jpeg', tamanho: MAX_BYTES + 1 } })).motivo, 'grande');
});

test('mimetypeDe', () => {
  assert.equal(mimetypeDe('image/webp'), 'image/webp');
  assert.equal(mimetypeDe(' Application/PDF '), 'application/pdf');
  assert.equal(mimetypeDe('audio/ogg; codecs=opus'), null);
  assert.equal(mimetypeDe(null), null);
});

/* ---------------- download com o Baileys (falso) e teto ---------------- */

test('baixarMidiaBaileys: usa o downloadMediaMessage em stream, com o reupload do socket; para ao passar do teto', async () => {
  const chamadas = [];
  const modulo = {
    downloadMediaMessage: async (m, tipo, opcoes, ctx) => { chamadas.push({ m, tipo, opcoes, ctx }); return Readable.from([JPEG.subarray(0, 5), JPEG.subarray(5)]); },
  };
  const sock = { updateMediaMessage: async (x) => ({ reenviada: x }) };
  const msgOriginal = { key: { id: 'W1' } };
  const r = await baixarMidiaBaileys(msgOriginal, sock, { modulo });
  assert.deepEqual(r.buffer, JPEG);
  assert.equal(chamadas[0].tipo, 'stream');
  assert.equal(chamadas[0].m, msgOriginal);
  assert.deepEqual(await chamadas[0].ctx.reuploadRequest('x'), { reenviada: 'x' });
  assert.equal(typeof chamadas[0].ctx.logger.info, 'function');

  let destruido = false;
  const grande = Readable.from((function* () { yield Buffer.alloc(60); yield Buffer.alloc(60); yield Buffer.alloc(60); })());
  grande.on('close', () => { destruido = true; });
  const r2 = await baixarMidiaBaileys(msgOriginal, sock, { modulo: { downloadMediaMessage: async () => grande }, limite: 100 });
  assert.deepEqual(r2, { grande: true });
  await tique();
  assert.equal(destruido, true, 'o stream foi cortado');
});

/* ---------------- a fila em disco ---------------- */

test('FilaMidia: guarda, lista, relê depois de reiniciar, ignora sobra e remove', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'midias-')); pastas.push(pasta);
  const dir = join(pasta, 'midias');
  const f = new FilaMidia(dir, { agora: () => AGORA });
  assert.equal(await f.guardar({ waId: 'A', chatJid: CLIENTE, mimetype: 'image/jpeg', buffer: JPEG }), true);
  assert.equal(await f.guardar({ waId: 'A', chatJid: CLIENTE, mimetype: 'image/jpeg', buffer: JPEG }), false, 'mesmo waId não duplica');
  assert.equal(await f.guardar({ waId: 'B', chatJid: CLIENTE, mimetype: 'application/pdf', buffer: PDF }), true);
  assert.equal(f.tamanho, 2);

  await writeFile(join(dir, 'sobra.bin'), 'lixo');
  await writeFile(join(dir, 'quebrado.json'), '{ não é json');
  const g = await new FilaMidia(dir).carregar();
  assert.deepEqual(g.listar().map((m) => m.waId), ['A', 'B']);
  assert.deepEqual(await g.ler(g.listar()[0].id), JPEG);
  const nomes = await readdir(dir);
  assert.ok(!nomes.includes('sobra.bin') && !nomes.includes('quebrado.json'), 'sobra e arquivo quebrado saem');

  await g.remover(g.listar()[0].id);
  assert.deepEqual((await readdir(dir)).sort().length, 2, 'sobra só o .bin e o .json do outro');
  assert.equal((await new FilaMidia(dir).carregar()).tamanho, 1);
});

test('FilaMidia: fila cheia (200 arquivos) não aceita mais', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'midias-')); pastas.push(pasta);
  const f = new FilaMidia(join(pasta, 'midias'));
  for (let i = 0; i < 200; i++) f.metas.set(`x${i}`, { id: `x${i}`, waId: `w${i}`, tamanho: 10, em: AGORA });
  assert.equal(await f.guardar({ waId: 'novo', chatJid: CLIENTE, mimetype: 'image/jpeg', buffer: JPEG }), false);
});

/* ---------------- a sessão: do WhatsApp até o CRM ---------------- */

class SocketFalso {
  constructor() {
    this.ev = new EventEmitter();
    this.user = { id: '5565988887777:12@s.whatsapp.net', lid: '99999999999:12@lid' };
  }
  async sendPresenceUpdate() {}
  async groupFetchAllParticipating() { return {}; }
  end() {}
  abrir() { this.ev.emit('connection.update', { connection: 'open' }); }
  receber(messages, type = 'notify') { this.ev.emit('messages.upsert', { messages, type }); }
}

function transporteFalso() {
  const t = {
    ordem: [],           // 'eventos' e 'midia', na ordem em que chegaram ao CRM
    eventos: [],
    midias: [],
    fora: false,
    resposta: null,      // (dados) => erro a lançar (ou undefined)
    async eventosPara(_id, lista) {
      if (t.fora) throw new Error('fetch failed');
      t.ordem.push('eventos');
      t.eventos.push(...structuredClone(lista));
      return { ok: true, processados: lista.length, erros: [] };
    },
    async confirmar() { return { ok: true }; },
    async midia(dados) {
      if (t.fora) throw new Error('fetch failed');
      const erro = t.resposta?.(dados);
      if (erro) throw erro;
      t.ordem.push('midia');
      t.midias.push({ ...dados, corpo: Buffer.from(dados.corpo) });
      return { ok: true };
    },
  };
  t.eventos_ = t.eventosPara;
  return t;
}
const httpErro = (status, texto = 'x') => Object.assign(new Error(`HTTP ${status}: ${texto}`), { httpStatus: status });

async function montar({ pasta = null, comMidia = true, baixar = null, transporte = null } = {}) {
  if (!pasta) { pasta = await mkdtemp(join(tmpdir(), 'sessao-midia-')); pastas.push(pasta); }
  const t = transporte || transporteFalso();
  const transp = { eventos: (...a) => t.eventosPara(...a), confirmar: (d) => t.confirmar(d) };
  if (comMidia) transp.midia = (d) => t.midia(d);
  const relogio = { t: AGORA };
  const sockets = [];
  const downloads = [];
  const amb = {
    pasta,
    criarSocket: async () => { const sock = new SocketFalso(); sockets.push(sock); return { sock }; },
    estaPareado: async () => true,
    agora: () => relogio.t,
    esperar: async (ms) => { relogio.t += ms; },
    agendar: (fn, ms) => ({ fn, ms }),
    cancelar: () => {},
    log: () => {},
    aleatorio: () => 0,
    baixarMidia: baixar || (async (m) => { downloads.push(m.key.id); return { buffer: JPEG }; }),
  };
  const s = new Sessao('cx-1', {}, transp, amb);
  await s.iniciar({});
  const sock = sockets.at(-1);
  sock.abrir();
  await tique();
  await s.descarregarAgora();
  t.ordem.length = 0; t.eventos.length = 0;
  return { s, t, sock, relogio, pasta, downloads, amb };
}

const base = (id, chat, extra = {}) => ({
  key: { remoteJid: chat, fromMe: false, id, ...(extra.key || {}) },
  messageTimestamp: Math.floor(AGORA / 1000) - 5,
  pushName: 'João',
  ...(chat.endsWith('@g.us') && !extra.key?.fromMe ? { participant: '5565911112222@s.whatsapp.net' } : {}),
});
const imagem = (id, chat = CLIENTE, extra = {}, img = {}) => ({
  ...base(id, chat, extra),
  message: { imageMessage: { mimetype: 'image/jpeg', fileLength: JPEG.length, caption: 'comprovante', url: 'https://mmg.whatsapp.net/x', mediaKey: 'k', ...img } },
});
const documento = (id, chat = CLIENTE, extra = {}, doc = {}) => ({
  ...base(id, chat, extra),
  message: { documentMessage: { mimetype: 'application/pdf', fileName: 'comprovante.pdf', fileLength: PDF.length, url: 'https://mmg.whatsapp.net/y', mediaKey: 'k', ...doc } },
});
const processar = async (c) => { await c.s.aguardarDownloads(); await c.s.descarregarAgora(); };

test('imagem do cliente: baixa, sobe com conexão, waId, chatJid e mimetype, e só depois da mensagem', async () => {
  const c = await montar();
  c.sock.receber([imagem('3EB0IMG1')]);
  await processar(c);
  assert.deepEqual(c.downloads, ['3EB0IMG1']);
  assert.equal(c.t.midias.length, 1);
  const m = c.t.midias[0];
  assert.deepEqual([m.conexaoId, m.waId, m.chatJid, m.mimetype], ['cx-1', '3EB0IMG1', CLIENTE, 'image/jpeg']);
  assert.deepEqual(m.corpo, JPEG);
  assert.deepEqual(c.t.ordem, ['eventos', 'midia'], 'o CRM conhece a mensagem antes de receber o arquivo');
  assert.equal(c.t.eventos[0].waId, '3EB0IMG1');
  assert.equal(c.s.midias.tamanho, 0, 'saiu do disco depois de subir');
  assert.deepEqual(await readdir(join(c.pasta, 'midias')), []);
});

test('PDF (documento) do cliente também sobe', async () => {
  const c = await montar({ baixar: async () => ({ buffer: PDF }) });
  c.sock.receber([documento('3EB0PDF1')]);
  await processar(c);
  assert.deepEqual([c.t.midias[0].mimetype, c.t.midias[0].waId], ['application/pdf', '3EB0PDF1']);
});

test('nunca baixa de grupo, do que o próprio mentorado manda, de áudio, vídeo, GIF, zip nem de visualização única', async () => {
  const c = await montar();
  c.s.atualizarOpcoes({ gruposPermitidos: [GRUPO] });
  c.sock.receber([
    imagem('G1', GRUPO),
    imagem('M1', CLIENTE, { key: { fromMe: true } }),
    { ...base('A1', CLIENTE), message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 3, fileLength: 900 } } },
    { ...base('V1', CLIENTE), message: { videoMessage: { mimetype: 'video/mp4', fileLength: 900 } } },
    imagem('GIF1', CLIENTE, {}, { mimetype: 'image/gif' }),
    documento('ZIP1', CLIENTE, {}, { mimetype: 'application/zip' }),
    documento('DOCX1', CLIENTE, {}, { mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    { ...base('VU1', CLIENTE), message: { viewOnceMessage: { message: { imageMessage: { mimetype: 'image/jpeg', viewOnce: true, fileLength: 100 } } } } },
  ]);
  await processar(c);
  assert.deepEqual(c.downloads, [], 'nenhum download foi pedido');
  assert.equal(c.t.midias.length, 0);
  // as mensagens em si continuam subindo como evento
  assert.ok(c.t.eventos.filter((e) => e.tipo === 'mensagem').length >= 7);
});

test('histórico do pareamento não baixa arquivos', async () => {
  const c = await montar({ opcoes: {} });
  c.s._aoReceberHistorico({ chats: [], contacts: [], messages: [imagem('H1')] });
  await processar(c);
  assert.deepEqual(c.downloads, []);
});

test('limite: o que a mensagem declara acima de 4 MB nem é baixado; o que passa de 4 MB no download não é guardado', async () => {
  const c = await montar();
  c.sock.receber([imagem('GRANDE1', CLIENTE, {}, { fileLength: MAX_BYTES + 1 })]);
  await processar(c);
  assert.deepEqual(c.downloads, [], 'não baixou o que já se sabia grande');
  assert.equal(c.t.midias.length, 0);

  const d = await montar({ baixar: async () => ({ buffer: Buffer.alloc(MAX_BYTES + 1, 1) }) });
  d.sock.receber([imagem('MENTIU1', CLIENTE, {}, { fileLength: 1000 })]);
  await processar(d);
  assert.equal(d.t.midias.length, 0, 'declarou 1 KB e mandou mais de 4 MB: descartado');
  assert.equal(d.s.midias.tamanho, 0);

  const e = await montar({ baixar: async () => ({ grande: true }) });
  e.sock.receber([imagem('MENTIU2', CLIENTE, {}, { fileLength: 1000 })]);
  await processar(e);
  assert.equal(e.t.midias.length, 0);

  const f = await montar({ baixar: async () => ({ buffer: Buffer.alloc(MAX_BYTES, 1) }) });
  f.sock.receber([imagem('CHEIO1', CLIENTE, {}, { fileLength: MAX_BYTES })]);
  await processar(f);
  assert.equal(f.t.midias.length, 1, '4 MB cheios passam');
});

test('download que falha não derruba nada: a mensagem sobe e o próximo comprovante é baixado', async () => {
  let n = 0;
  const c = await montar({ baixar: async () => { if (++n === 1) throw new Error('410 Gone'); return { buffer: JPEG }; } });
  c.sock.receber([imagem('F1'), imagem('F2')]);
  await processar(c);
  assert.deepEqual(c.t.midias.map((m) => m.waId), ['F2']);
  assert.deepEqual(c.t.eventos.filter((e) => e.tipo === 'mensagem').map((e) => e.waId), ['F1', 'F2']);
});

test('downloads saem um de cada vez', async () => {
  let ativos = 0, pico = 0;
  const c = await montar({ baixar: async () => { pico = Math.max(pico, ++ativos); await tique(); await tique(); ativos--; return { buffer: JPEG }; } });
  c.sock.receber([imagem('P1'), imagem('P2'), imagem('P3')]);
  await processar(c);
  assert.equal(pico, 1);
  assert.equal(c.t.midias.length, 3);
});

test('com o CRM fora do ar o arquivo fica no disco (spool) e sobe quando ele volta; nada é perdido nem repetido', async () => {
  const c = await montar();
  c.t.fora = true;
  c.sock.receber([imagem('SP1'), documento('SP2')]);
  await c.s.aguardarDownloads();
  await c.s.descarregarAgora();
  assert.equal(c.t.midias.length, 0);
  assert.equal(c.s.midias.tamanho, 2);
  const nomes = await readdir(join(c.pasta, 'midias'));
  assert.equal(nomes.filter((n) => n.endsWith('.bin')).length, 2);

  // reinicia o processo: um Sessao novo na mesma pasta relê o disco
  c.t.fora = false;
  const t2 = c.t;
  const r = await montar({ pasta: c.pasta, transporte: t2, baixar: async () => ({ buffer: Buffer.from('nao deveria baixar') }) });
  await r.s.descarregarAgora();
  assert.deepEqual(t2.midias.map((m) => m.waId).sort(), ['SP1', 'SP2']);
  assert.deepEqual(t2.midias.find((m) => m.waId === 'SP1').corpo, JPEG);
  assert.equal(r.s.midias.tamanho, 0);
  await r.s.descarregarAgora();
  assert.equal(t2.midias.length, 2, 'não sobe de novo');
});

test('a mensagem ainda na fila de eventos segura o arquivo: o CRM precisa conhecer o waId antes', async () => {
  const c = await montar();
  c.t.fora = true;           // eventos e midia falham
  c.sock.receber([imagem('ORD1')]);
  await c.s.aguardarDownloads();
  await c.s.descarregarAgora();
  assert.equal(c.s.spool.tamanho > 0, true, 'o evento da mensagem ainda não subiu');
  c.t.fora = false;
  c.t.resposta = () => { throw new Error('não pode tentar o arquivo antes da mensagem'); };
  c.s._proximaMidia = 0;
  await c.s._drenarMidias();                 // spool cheio: nem tenta
  assert.equal(c.t.midias.length, 0);
  c.t.resposta = null;
  await c.s.descarregarAgora();              // eventos primeiro, arquivo depois
  assert.deepEqual(c.t.ordem, ['eventos', 'midia']);
});

test('respostas do CRM: 404 tenta de novo (até 5 vezes), recusa definitiva descarta, erro de servidor/rede espera com backoff', async () => {
  // 404: a mensagem ainda não chegou ao banco
  const c = await montar();
  let respostas404 = 0;
  c.t.resposta = () => { respostas404++; return httpErro(404, 'mensagem_desconhecida'); };
  c.sock.receber([imagem('R404')]);
  await processar(c);
  assert.equal(c.s.midias.tamanho, 1, 'primeira tentativa: ainda guardado');
  while (c.s.midias.tamanho && respostas404 < 20) await c.s.descarregarAgora();
  assert.equal(c.s.midias.tamanho, 0, 'desistiu');
  assert.equal(respostas404, 5, 'depois de exatamente 5 respostas 404');

  for (const status of [400, 403, 413, 415, 422]) {
    const d = await montar();
    d.t.resposta = () => httpErro(status, status === 422 ? 'privacidade' : 'x');
    d.sock.receber([imagem(`R${status}`)]);
    await processar(d);
    assert.equal(d.s.midias.tamanho, 0, `${status}: descartado`);
    assert.equal(d.t.midias.length, 0);
  }

  const e = await montar();
  let falhas = 0;
  e.t.resposta = () => { falhas++; return httpErro(503, 'indisponível'); };
  e.sock.receber([imagem('R503')]);
  await processar(e);
  assert.equal(e.s.midias.tamanho, 1, '5xx: continua guardado');
  assert.ok(e.s._proximaMidia > e.relogio.t, 'com espera marcada');
  const antes = falhas;
  await e.s._drenarMidias();       // dentro da espera: não tenta
  assert.equal(falhas, antes);
  e.t.resposta = (d) => (d.waId === 'R503' ? httpErro(401, 'credencial_invalida') : undefined);
  await e.s.descarregarAgora();
  assert.equal(e.s.midias.tamanho, 1, '401 (segredo ou relógio): também guarda e espera');
  e.t.resposta = null;
  await e.s.descarregarAgora();
  assert.equal(e.s.midias.tamanho, 0);
  assert.equal(e.t.midias.length, 1);
});

test('comprovante que o CRM não aceita em 24 h é descartado', async () => {
  const c = await montar();
  c.t.resposta = () => httpErro(503);
  c.sock.receber([imagem('VELHO1')]);
  await processar(c);
  assert.equal(c.s.midias.tamanho, 1);
  c.t.resposta = null;
  c.relogio.t += 25 * 3600_000;
  await c.s.descarregarAgora();
  assert.equal(c.s.midias.tamanho, 0);
  assert.equal(c.t.midias.length, 0);
});

test('transporte sem suporte a arquivo (CRM antigo): não baixa nada', async () => {
  const c = await montar({ comMidia: false });
  c.sock.receber([imagem('SEM1')]);
  await processar(c);
  assert.deepEqual(c.downloads, []);
});

test('sessão parada ou desconectada durante o download não deixa arquivo na pasta', async () => {
  let soltar;
  const segurado = new Promise((r) => { soltar = r; });
  const c = await montar({ baixar: async () => { await segurado; return { buffer: JPEG }; } });
  c.sock.receber([imagem('PAR1')]);
  await tique();
  const desconectando = c.s.desconectar();
  soltar();
  await desconectando.catch(() => {});
  await c.s.aguardarDownloads();
  await assert.rejects(readdir(join(c.pasta, 'midias')), /ENOENT/, 'a pasta da sessão sumiu e nada foi recriado');
});

/* ---------------- o envio: HMAC sobre os bytes ---------------- */

const SEGREDO = 'exemplo-de-segredo-so-para-teste-0123456789';
const TS = 1_791_000_000_000;

function fetchFalso(resposta = { status: 200, corpo: '{"ok":true}' }) {
  const chamadas = [];
  const f = async (url, init) => {
    chamadas.push({ url: new URL(url), ...init });
    return { ok: resposta.status < 400, status: resposta.status, text: async () => resposta.corpo };
  };
  f.chamadas = chamadas;
  return f;
}

test('transporte do gateway: POST /api/gateway/midia com o arquivo cru, cabeçalhos e HMAC sobre os bytes', async () => {
  const f = fetchFalso();
  const t = criarTransporteGateway({ base: 'https://crm.exemplo.com.br', segredo: SEGREDO, fetch: f, agora: () => TS });
  const r = await t.midia({ conexaoId: 'cx-1', waId: '3EB0ABC', chatJid: CLIENTE, mimetype: 'image/jpeg', corpo: JPEG });
  assert.deepEqual(r, { ok: true });
  const c = f.chamadas[0];
  assert.equal(c.url.pathname, '/api/gateway/midia');
  assert.equal(c.method, 'POST');
  assert.deepEqual(Buffer.from(c.body), JPEG);
  assert.equal(c.headers['Content-Type'], 'image/jpeg');
  assert.equal(c.headers['x-conexao-id'], 'cx-1');
  assert.equal(c.headers['x-wa-id'], '3EB0ABC');
  assert.equal(c.headers['x-chat-jid'], CLIENTE);
  assert.equal(c.headers['x-gateway-ts'], String(TS));
  const esperado = createHmac('sha256', SEGREDO).update(`${TS}.POST./api/gateway/midia.${createHash('sha256').update(JPEG).digest('hex')}`).digest('hex');
  assert.equal(c.headers['x-gateway-assinatura'], esperado);
  assert.equal(c.headers['x-gateway-assinatura'], assinar(SEGREDO, String(TS), 'POST', '/api/gateway/midia', JPEG));
  // outro arquivo, outra assinatura
  await t.midia({ conexaoId: 'cx-1', waId: '3EB0ABC', chatJid: CLIENTE, mimetype: 'image/jpeg', corpo: Buffer.concat([JPEG, Buffer.from('x')]) });
  assert.notEqual(f.chamadas[1].headers['x-gateway-assinatura'], esperado);
});

test('transporte do gateway: erro do CRM traz o status; cabeçalho com caractere estranho nem sai', async () => {
  const t = criarTransporteGateway({ base: 'https://crm.exemplo.com.br', segredo: SEGREDO, fetch: fetchFalso({ status: 422, corpo: '{"erro":"privacidade"}' }), agora: () => TS });
  await assert.rejects(t.midia({ conexaoId: 'cx-1', waId: 'W', chatJid: CLIENTE, mimetype: 'image/png', corpo: JPEG }), (e) => e.httpStatus === 422 && /privacidade/.test(e.message));
  const f = fetchFalso();
  const t2 = criarTransporteGateway({ base: 'https://crm.exemplo.com.br', segredo: SEGREDO, fetch: f, agora: () => TS });
  await assert.rejects(t2.midia({ conexaoId: 'cx-1', waId: 'W\r\nX: y', chatJid: CLIENTE, mimetype: 'image/png', corpo: JPEG }), (e) => e.httpStatus === 400);
  await assert.rejects(t2.midia({ conexaoId: 'cx-1', waId: 'W', chatJid: CLIENTE, mimetype: 'image/png', corpo: Buffer.alloc(0) }), (e) => e.httpStatus === 400);
  assert.equal(f.chamadas.length, 0);
});

test('transporte do modo PC: x-bot-conexao e x-bot-segredo, sem HMAC', async () => {
  const f = fetchFalso();
  const t = criarTransportePC({ base: 'https://crm.exemplo.com.br', conexaoId: 'cx-pc', segredo: 'seg-pc', fetch: f });
  await t.midia({ conexaoId: 'ignorado', waId: 'W9', chatJid: CLIENTE, mimetype: 'application/pdf', corpo: PDF });
  const h = f.chamadas[0].headers;
  assert.deepEqual([h['x-bot-conexao'], h['x-bot-segredo'], h['Content-Type'], h['x-wa-id']], ['cx-pc', 'seg-pc', 'application/pdf', 'W9']);
  assert.equal(h['x-gateway-assinatura'], undefined);
  assert.equal(h['x-conexao-id'], undefined);
});

test('o arquivo baixado nunca vai dentro do spool de eventos (só o evento, sem bytes)', async () => {
  const c = await montar();
  c.t.fora = true;
  c.sock.receber([imagem('SPOOL1')]);
  await c.s.aguardarDownloads();
  await c.s.descarregarAgora();
  const jsonl = await readFile(join(c.pasta, 'pendentes.jsonl'), 'utf8');
  assert.ok(!jsonl.includes(JPEG.toString('base64')) && !jsonl.includes('pix R$'));
});
