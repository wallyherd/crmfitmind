// Ponta a ponta sem WhatsApp: o processo filho e o gateway.mjs de verdade, falando com um
// CRM falso em 127.0.0.1 que confere a assinatura HMAC de cada chamada.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { fork, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verificarAssinatura, assinar } from '../nuvem.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEGREDO = 'f'.repeat(64);
const pastas = [];
after(async () => { for (const p of pastas) await rm(p, { recursive: true, force: true }); });

/** CRM falso: registra cada chamada e diz se a assinatura bate. */
async function crmFalso(respostas = {}) {
  const chamadas = [];
  const srv = createServer((req, res) => {
    const pedacos = [];
    req.on('data', (p) => pedacos.push(p));
    req.on('end', () => {
      const corpo = Buffer.concat(pedacos);
      const url = new URL(req.url, 'http://x');
      const assinaturaOk = verificarAssinatura({
        segredo: SEGREDO, ts: req.headers['x-gateway-ts'], assinatura: req.headers['x-gateway-assinatura'],
        metodo: req.method, caminho: url.pathname, corpo,
      });
      chamadas.push({ metodo: req.method, caminho: url.pathname, assinaturaOk, corpo: corpo.length ? JSON.parse(corpo) : null });
      const r = respostas[url.pathname] ?? { ok: true, processados: 0, erros: [] };
      res.writeHead(assinaturaOk ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(assinaturaOk ? r : { erro: 'assinatura' }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { chamadas, base: `http://127.0.0.1:${srv.address().port}`, fechar: () => srv.close() };
}

const esperarAte = async (cond, ms = 10_000) => {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error('tempo esgotado');
    await new Promise((r) => setTimeout(r, 25));
  }
};

test('filho.mjs: sem sessão salva avisa o CRM (assinado) e sai com o código "precisa parear"', async () => {
  const crm = await crmFalso();
  const dados = await mkdtemp(join(tmpdir(), 'filho-')); pastas.push(dados);
  const filho = fork(join(RAIZ, 'filho.mjs'), ['cx-teste-1'], {
    env: { ...process.env, CRM_BASE: crm.base, GATEWAY_SECRET: SEGREDO, DADOS_DIR: dados },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const saida = new Promise((r) => filho.on('exit', r));
  filho.send({ tipo: 'iniciar', opcoes: {}, pareamento: null });
  const codigo = await saida;
  crm.fechar();
  assert.equal(codigo, 10);
  const eventos = crm.chamadas.filter((c) => c.caminho === '/api/bot/eventos');
  assert.ok(eventos.length >= 1);
  assert.ok(eventos.every((c) => c.assinaturaOk), 'toda chamada assinada');
  assert.equal(eventos[0].corpo.conexaoId, 'cx-teste-1');
  assert.deepEqual(eventos.flatMap((c) => c.corpo.eventos), [{ tipo: 'status', status: 'desconectado', detalhe: 'sem_sessao' }]);
});

test('filho.mjs recusa conexaoId que poderia virar caminho de pasta', async () => {
  const filho = fork(join(RAIZ, 'filho.mjs'), ['../../x'], { env: { ...process.env, CRM_BASE: 'http://127.0.0.1:1', GATEWAY_SECRET: SEGREDO }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  assert.equal(await new Promise((r) => filho.on('exit', r)), 2);
});

function postar(porta, caminho, corpo, cabecalhos) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: porta, method: 'POST', path: caminho, headers: { 'Content-Type': 'application/json', ...cabecalhos } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(corpo);
  });
}

test('gateway.mjs: lê as conexões assinado, responde a campainha e recusa sem assinatura', async () => {
  const crm = await crmFalso({ '/api/gateway/conexoes': { conexoes: [] }, '/api/gateway/fila': { mensagens: [] } });
  const dados = await mkdtemp(join(tmpdir(), 'gw-')); pastas.push(dados);
  const porta = 20000 + Math.floor(Math.random() * 20000);
  const gw = spawn(process.execPath, [join(RAIZ, 'gateway.mjs')], {
    env: { ...process.env, CRM_BASE: crm.base, GATEWAY_SECRET: SEGREDO, DADOS_DIR: dados, GATEWAY_PORTA: String(porta), GATEWAY_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let saidaPadrao = '';
  gw.stdout.on('data', (b) => { saidaPadrao += b; });
  try {
    await esperarAte(() => saidaPadrao.includes('campainha em') && crm.chamadas.some((c) => c.caminho === '/api/gateway/conexoes'));
    assert.ok(crm.chamadas.every((c) => c.assinaturaOk));

    const corpo = JSON.stringify({ conexaoId: null, motivo: 'fila' });
    const ts = String(Date.now());
    assert.equal(await postar(porta, '/acordar', corpo, { 'x-gateway-ts': ts, 'x-gateway-assinatura': assinar(SEGREDO, ts, 'POST', '/acordar', corpo) }), 202);
    await esperarAte(() => crm.chamadas.some((c) => c.caminho === '/api/gateway/fila'));
    assert.equal(await postar(porta, '/acordar', corpo, {}), 401);
    assert.equal(await postar(porta, '/qualquer', corpo, {}), 404);
    assert.ok(!saidaPadrao.includes(SEGREDO), 'o segredo não aparece no log');
  } finally {
    gw.kill();
    crm.fechar();
  }
});

function chamarPainel(porta, { metodo = 'GET', caminho = '/', corpo, cabecalhos = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: { Host: `127.0.0.1:${porta}`, ...cabecalhos } }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, corpo: b, cabecalhos: res.headers }));
    });
    req.on('error', reject);
    req.end(corpo);
  });
}

test('pc.mjs: painel só local, sem CSRF nem DNS rebinding, e fala com o CRM pelo segredo da conexão', async () => {
  const chamadas = [];
  const crm = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      chamadas.push({ caminho: req.url, conexao: req.headers['x-bot-conexao'], segredo: req.headers['x-bot-segredo'], corpo: b ? JSON.parse(b) : null });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(req.url.startsWith('/api/bot/fila') ? { mensagens: [] } : { ok: true, processados: 1, erros: [] }));
    });
  });
  await new Promise((r) => crm.listen(0, '127.0.0.1', r));
  const pasta = await mkdtemp(join(tmpdir(), 'pc-')); pastas.push(pasta);
  const porta = 20000 + Math.floor(Math.random() * 20000);
  const pc = spawn(process.execPath, [join(RAIZ, 'pc.mjs')], {
    env: { ...process.env, PASTA_PC: pasta, PORT: String(porta), CRM_BASE: `http://127.0.0.1:${crm.address().port}` },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let log = '';
  pc.stdout.on('data', (b) => { log += b; });
  try {
    await esperarAte(() => log.includes('Painel:'));
    const pagina = await chamarPainel(porta);
    assert.equal(pagina.status, 200);
    assert.match(pagina.cabecalhos['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal((await chamarPainel(porta, { caminho: '/api/estado', cabecalhos: { Host: `ataque.com:${porta}` } })).status, 403, 'DNS rebinding');
    const json = JSON.stringify({ conexaoId: 'cx-pc-1', segredo: 'segredo-da-conexao' });
    assert.equal((await chamarPainel(porta, { metodo: 'POST', caminho: '/api/config', corpo: json, cabecalhos: { 'Content-Type': 'text/plain' } })).status, 415, 'CSRF por text/plain');
    assert.equal((await chamarPainel(porta, { metodo: 'POST', caminho: '/api/config', corpo: json, cabecalhos: { 'Content-Type': 'application/json', Origin: 'https://ataque.com' } })).status, 403, 'origem estranha');
    const base = JSON.stringify({ conexaoId: 'cx-pc-1', segredo: 'segredo-da-conexao', base: 'https://ataque.com' });
    assert.equal((await chamarPainel(porta, { metodo: 'POST', caminho: '/api/config', corpo: base, cabecalhos: { 'Content-Type': 'application/json' } })).status, 200);
    const estado = JSON.parse((await chamarPainel(porta, { caminho: '/api/estado' })).corpo);
    assert.equal(estado.configurado, true);
    assert.equal(estado.envioLigado, false);
    assert.ok(!JSON.stringify(estado).includes('segredo-da-conexao'), 'o segredo não volta para a tela');
    const teste = JSON.parse((await chamarPainel(porta, { metodo: 'POST', caminho: '/api/testar-nuvem', corpo: '{}', cabecalhos: { 'Content-Type': 'application/json' } })).corpo);
    assert.equal(teste.ok, true);
    await esperarAte(() => chamadas.some((c) => c.corpo?.eventos?.some((e) => e.tipo === 'batimento')));
    for (const c of chamadas) {
      assert.equal(c.conexao, 'cx-pc-1');
      assert.equal(c.segredo, 'segredo-da-conexao');
      assert.equal(c.corpo?.conexaoId, undefined);
    }
    // O campo "base" mandado pelo painel foi ignorado: as chamadas foram para o CRM do ambiente.
    assert.ok(chamadas.length >= 1);
  } finally {
    pc.kill();
    crm.close();
  }
});

test('gateway.mjs não sobe sem segredo forte nem com CRM_BASE http fora do localhost', async () => {
  for (const env of [{ CRM_BASE: 'https://crm.exemplo.com.br', GATEWAY_SECRET: 'curto' }, { CRM_BASE: 'http://crm.exemplo.com.br', GATEWAY_SECRET: SEGREDO }]) {
    const gw = spawn(process.execPath, [join(RAIZ, 'gateway.mjs')], { env: { ...process.env, ...env, GATEWAY_PORTA: '0' }, stdio: 'ignore' });
    assert.equal(await new Promise((r) => gw.on('exit', r)), 1);
  }
});
