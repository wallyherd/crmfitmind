// Supervisor com processos filhos FALSOS: decide quem sobe, quem para, quem desconecta.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Supervisor, SAIDA } from '../supervisor.mjs';

const AGORA = Date.parse('2026-10-07T15:00:00.000Z');
const pastas = [];
after(async () => { for (const p of pastas) await rm(p, { recursive: true, force: true }); });

class FilhoFalso extends EventEmitter {
  constructor(id) { super(); this.id = id; this.recebidas = []; }
  send(m) { this.recebidas.push(m); }
  kill() { this.emit('exit', null); }
  sair(codigo) { this.emit('exit', codigo); }
}

async function montar({ conexoes = [], pareadas = [], fila = [] } = {}) {
  const dados = await mkdtemp(join(tmpdir(), 'gw-')); pastas.push(dados);
  const relogio = { t: AGORA };
  const filhos = [];
  const esperas = [];
  const t = {
    lista: conexoes, pendentes: fila, confirmacoes: [], fora: false,
    async conexoes() { if (t.fora) throw new Error('fetch failed'); return { conexoes: t.lista }; },
    async fila() { const m = t.pendentes; t.pendentes = []; return { mensagens: m }; },
    async confirmar(d) { t.confirmacoes.push(d); return { ok: true }; },
  };
  const sup = new Supervisor({
    transporte: t, dados, log: () => {},
    fork: (id) => { const f = new FilhoFalso(id); filhos.push(f); return f; },
    agora: () => relogio.t,
    esperar: async (ms) => { esperas.push(ms); relogio.t += ms; },
    aleatorio: () => 0.5,
    estaPareado: async (pastaAuth) => pareadas.some((id) => pastaAuth.includes(id)),
  });
  return { sup, t, filhos, esperas, relogio, dados };
}

const cx = (id, extra = {}) => ({ id, deveRodar: true, pareamento: null, opcoes: { gruposPermitidos: [], historicoDias: 7, botAtivo: false }, ...extra });
const filhoDe = (c, id) => c.filhos.filter((f) => f.id === id).at(-1);

test('sobe as sessões pareadas uma a uma, com 5 a 15 s entre elas', async () => {
  const c = await montar({ conexoes: [cx('a'), cx('b'), cx('c')], pareadas: ['a', 'b', 'c'] });
  await c.sup.sincronizar();
  await c.sup.ocioso();
  assert.deepEqual(c.filhos.map((f) => f.id), ['a', 'b', 'c']);
  assert.deepEqual(c.esperas, [10_000, 10_000]); // aleatorio 0,5 -> 5 s + 5 s
  assert.deepEqual(filhoDe(c, 'a').recebidas[0], { tipo: 'iniciar', opcoes: cx('a').opcoes, pareamento: null });
  // Sincronizar de novo não cria processo repetido.
  await c.sup.sincronizar();
  await c.sup.ocioso();
  assert.equal(c.filhos.length, 3);
});

test('sem sessão salva e sem pedido: não cria processo; pedido de pareamento novo cria e passa na frente', async () => {
  const c = await montar({ conexoes: [cx('velha'), cx('nova')], pareadas: ['velha'] });
  await c.sup.sincronizar();
  await c.sup.ocioso();
  assert.deepEqual(c.filhos.map((f) => f.id), ['velha']);
  const pareamento = { metodo: 'codigo', telefone: '5565988887777', solicitadoEm: new Date(AGORA).toISOString() };
  c.t.lista = [cx('velha'), cx('nova', { pareamento })];
  await c.sup.aoAcordar({ conexaoId: 'nova', motivo: 'parear' });
  await c.sup.ocioso();
  assert.deepEqual(filhoDe(c, 'nova').recebidas[0], { tipo: 'iniciar', opcoes: cx('nova').opcoes, pareamento: { metodo: 'codigo', telefone: '5565988887777' } });
  // O mesmo pedido, lido de novo, não dispara outro pareamento.
  await c.sup.sincronizar();
  assert.equal(filhoDe(c, 'nova').recebidas.filter((m) => m.tipo === 'parear').length, 0);
});

test('pedido de pareamento que chega com a sessão ainda na fila de início não se perde', async () => {
  const c = await montar({ conexoes: [cx('a'), cx('b')], pareadas: ['a', 'b'] });
  // Segura a fila de início: a primeira espera só termina quando liberarmos.
  let liberar;
  c.sup.esperar = () => new Promise((r) => { liberar = r; });
  await c.sup.sincronizar();
  assert.deepEqual(c.filhos.map((f) => f.id), ['a']);
  const pareamento = { metodo: 'qr', solicitadoEm: new Date(AGORA).toISOString() };
  c.t.lista = [cx('a'), cx('b', { pareamento })];
  await c.sup.sincronizar();
  c.sup.esperar = async () => {};
  liberar();
  await c.sup.ocioso();
  assert.deepEqual(c.filhos.map((f) => f.id), ['a', 'b']);
  assert.deepEqual(filhoDe(c, 'b').recebidas[0].pareamento, { metodo: 'qr', telefone: null });
});

test('pedido de pareamento com mais de 10 minutos é resto, não pedido', async () => {
  const velho = { metodo: 'qr', solicitadoEm: new Date(AGORA - 11 * 60_000).toISOString() };
  const c = await montar({ conexoes: [cx('x', { pareamento: velho })] });
  await c.sup.sincronizar();
  await c.sup.ocioso();
  assert.equal(c.filhos.length, 0);
});

test('opções mudaram: vão para o processo que está rodando', async () => {
  const c = await montar({ conexoes: [cx('a')], pareadas: ['a'] });
  await c.sup.sincronizar(); await c.sup.ocioso();
  const novas = { gruposPermitidos: ['1@g.us'], historicoDias: 7, botAtivo: true };
  c.t.lista = [cx('a', { opcoes: novas })];
  await c.sup.aoAcordar({ conexaoId: 'a', motivo: 'opcoes' });
  assert.deepEqual(filhoDe(c, 'a').recebidas.at(-1), { tipo: 'opcoes', opcoes: novas });
});

test('deveRodar false para sem deslogar; com a campainha "desconectar", desconecta', async () => {
  const c = await montar({ conexoes: [cx('a'), cx('b')], pareadas: ['a', 'b'] });
  await c.sup.sincronizar(); await c.sup.ocioso();
  c.t.lista = [cx('a', { deveRodar: false }), cx('b', { deveRodar: false })];
  await c.sup.aoAcordar({ conexaoId: 'b', motivo: 'desconectar' });
  assert.equal(filhoDe(c, 'a').recebidas.at(-1).tipo, 'parar');
  assert.equal(filhoDe(c, 'b').recebidas.at(-1).tipo, 'desconectar');
});

test('desconectar pela lista (sem campainha): ordem enviada uma vez só; sem processo, cria um só para isso', async () => {
  const c = await montar({ conexoes: [cx('a'), cx('b')], pareadas: ['a', 'b'] });
  await c.sup.sincronizar(); await c.sup.ocioso();
  await mkdir(join(c.dados, 'sessoes', 'c'), { recursive: true });
  c.t.lista = [cx('a', { deveRodar: false, desconectar: true }), cx('b'), cx('c', { deveRodar: false, desconectar: true })];
  await c.sup.sincronizar();
  await c.sup.sincronizar();
  assert.deepEqual(filhoDe(c, 'a').recebidas.filter((m) => m.tipo === 'desconectar' || m.tipo === 'parar').map((m) => m.tipo), ['desconectar']);
  assert.equal(filhoDe(c, 'c').recebidas[0].tipo, 'desconectar');
  filhoDe(c, 'a').sair(SAIDA.desconectada);
  await c.sup.sincronizar();
  assert.equal(c.filhos.filter((f) => f.id === 'a').length, 1, 'pasta já apagada: não cria outro');
  assert.ok(!filhoDe(c, 'b').recebidas.some((m) => m.tipo === 'parar' || m.tipo === 'desconectar'));
});

test('"desconectar" que chega depois de um "parar" não se perde, nem se o processo já saiu como parado', async () => {
  const c = await montar({ conexoes: [cx('a'), cx('b')], pareadas: ['a', 'b'] });
  await c.sup.sincronizar(); await c.sup.ocioso();
  for (const id of ['a', 'b']) await mkdir(join(c.dados, 'sessoes', id), { recursive: true });
  c.t.lista = [cx('a', { deveRodar: false }), cx('b', { deveRodar: false })];
  await c.sup.sincronizar();                      // o CRM já disse deveRodar:false antes da campainha
  assert.equal(filhoDe(c, 'a').recebidas.at(-1).tipo, 'parar');
  await c.sup.aoAcordar({ conexaoId: 'a', motivo: 'desconectar' });
  assert.equal(filhoDe(c, 'a').recebidas.at(-1).tipo, 'desconectar', '"parar" sobe para "desconectar"');

  await c.sup.aoAcordar({ conexaoId: 'b', motivo: 'desconectar' });
  const primeiroB = c.filhos.find((f) => f.id === 'b' && f.recebidas.some((m) => m.tipo === 'parar'));
  primeiroB.sair(SAIDA.parada);                   // saiu antes de atender o "desconectar"
  await new Promise((r) => setImmediate(r));
  await c.sup.ocioso();
  assert.equal(filhoDe(c, 'b').recebidas[0].tipo, 'desconectar');
  assert.notEqual(filhoDe(c, 'b'), primeiroB);
});

test('pedido de pareamento que chega enquanto o processo ainda está parando vai para o processo novo', async () => {
  const c = await montar({ conexoes: [cx('a')], pareadas: ['a'] });
  await c.sup.sincronizar(); await c.sup.ocioso();
  c.t.lista = [cx('a', { deveRodar: false })];
  await c.sup.sincronizar();
  const velho = filhoDe(c, 'a');
  assert.equal(velho.recebidas.at(-1).tipo, 'parar');
  const pareamento = { metodo: 'qr', solicitadoEm: new Date(AGORA).toISOString() };
  c.t.lista = [cx('a', { pareamento })];
  await c.sup.sincronizar();
  assert.ok(!velho.recebidas.some((m) => m.tipo === 'parear'), 'o processo que está saindo não recebe o pedido');
  velho.sair(SAIDA.parada);
  await new Promise((r) => setImmediate(r));
  await c.sup.ocioso();
  assert.notEqual(filhoDe(c, 'a'), velho);
  assert.deepEqual(filhoDe(c, 'a').recebidas[0].pareamento, { metodo: 'qr', telefone: null });
});

test('campainha "desconectar" com o CRM ainda dizendo deveRodar true não derruba nada', async () => {
  const c = await montar({ conexoes: [cx('a')], pareadas: ['a'] });
  await c.sup.sincronizar(); await c.sup.ocioso();
  await c.sup.aoAcordar({ conexaoId: 'a', motivo: 'desconectar' });
  assert.ok(!filhoDe(c, 'a').recebidas.some((m) => m.tipo === 'desconectar' || m.tipo === 'parar'));
});

test('CRM fora do ar: ninguém é parado nem iniciado', async () => {
  const c = await montar({ conexoes: [cx('a')], pareadas: ['a'] });
  await c.sup.sincronizar(); await c.sup.ocioso();
  c.t.fora = true;
  await c.sup.sincronizar();
  assert.equal(filhoDe(c, 'a').recebidas.length, 1);
});

test('fila agregada: cada mensagem vai para a sua sessão; sem sessão viva, volta com erro', async () => {
  const c = await montar({ conexoes: [cx('a')], pareadas: ['a'] });
  await c.sup.sincronizar(); await c.sup.ocioso();
  c.t.pendentes = [
    { id: 'm1', conexaoId: 'a', para: '5565999990000@s.whatsapp.net', corpo: 'oi', tipo: 'texto' },
    { id: 'm2', conexaoId: 'zzz', para: '5565999990000@s.whatsapp.net', corpo: 'oi', tipo: 'texto' },
  ];
  await c.sup.aoAcordar({ conexaoId: 'a', motivo: 'fila' });
  assert.deepEqual(filhoDe(c, 'a').recebidas.at(-1), {
    tipo: 'enviar',
    mensagens: [{ id: 'm1', conexaoId: 'a', para: '5565999990000@s.whatsapp.net', corpo: 'oi', tipo: 'texto' }],
  });
  assert.deepEqual(c.t.confirmacoes, [{ id: 'm2', status: 'erro', erro: 'sessao_parada' }]);
});

test('filho caiu: religa com espera crescente; parou por precisar parear: só volta com pedido novo', async () => {
  const c = await montar({ conexoes: [cx('a'), cx('b')], pareadas: ['a', 'b'] });
  await c.sup.sincronizar(); await c.sup.ocioso();
  filhoDe(c, 'a').sair(1);                 // exceção
  filhoDe(c, 'b').sair(SAIDA.deslogado);   // saiu do aparelho no celular
  await c.sup.sincronizar(); await c.sup.ocioso();
  assert.equal(c.filhos.length, 2, 'dentro da espera nada religa');
  c.relogio.t += 11_000;
  await c.sup.sincronizar(); await c.sup.ocioso();
  assert.deepEqual(c.filhos.map((f) => f.id), ['a', 'b', 'a']);
  assert.equal(c.sup.sessoes.get('b').bloqueado.motivo, 'deslogado');
  const pareamento = { metodo: 'qr', solicitadoEm: new Date(c.relogio.t).toISOString() };
  c.t.lista = [cx('a'), cx('b', { pareamento })];
  await c.sup.sincronizar(); await c.sup.ocioso();
  assert.equal(filhoDe(c, 'b').recebidas[0].pareamento.metodo, 'qr');
});

test('pasta de sessão parada há mais de 7 dias: sai do aparelho e apaga (LGPD)', async () => {
  const c = await montar({ conexoes: [] });
  const pasta = join(c.dados, 'sessoes', 'antiga');
  await mkdir(pasta, { recursive: true });
  await c.sup.sincronizar();
  const marca = JSON.parse(await readFile(join(pasta, 'parada.json'), 'utf8'));
  assert.equal(marca.desde, new Date(AGORA).toISOString());
  assert.equal(c.filhos.length, 0, 'no primeiro dia só marca');
  await writeFile(join(pasta, 'parada.json'), JSON.stringify({ desde: new Date(AGORA - 8 * 86400_000).toISOString() }));
  await c.sup.sincronizar();
  assert.deepEqual(c.filhos.map((f) => [f.id, f.recebidas[0].tipo]), [['antiga', 'desconectar']]);
});

test('id de conexão fora do padrão é ignorado (não vira caminho de pasta)', async () => {
  const c = await montar({ conexoes: [cx('../../etc'), cx('a b')], pareadas: [] });
  await c.sup.sincronizar(); await c.sup.ocioso();
  assert.equal(c.sup.sessoes.size, 0);
});
