// Assinatura HMAC, transportes e o servidor da campainha. Nenhuma chamada sai da máquina:
// o fetch é falso e o servidor escuta em 127.0.0.1 numa porta livre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { request } from 'node:http';
import {
  assinar, verificarAssinatura, criarTransporteGateway, criarTransportePC, criarServidorAcordar, validarBase, sha256hex,
} from '../nuvem.mjs';

const SEGREDO = 'x'.repeat(64);
const AGORA = 1_791_000_000_000;

test('assinatura segue exatamente a fórmula do contrato', () => {
  const corpo = '{"conexaoId":"abc","eventos":[]}';
  const esperado = createHmac('sha256', SEGREDO)
    .update(`${AGORA}.POST./api/bot/eventos.${createHash('sha256').update(corpo).digest('hex')}`)
    .digest('hex');
  assert.equal(assinar(SEGREDO, String(AGORA), 'post', '/api/bot/eventos', corpo), esperado);
  // Corpo vazio = sha256 da string vazia.
  assert.equal(sha256hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('vetores de teste publicados no CONTRATO.md §1 (a fatia do servidor confere com eles)', () => {
  const s = 'exemplo-de-segredo-so-para-teste-0123456789';
  const ts = '1791000000000';
  const corpo = '{"conexaoId":"8f2d6a8e-1111-4b55-9d0f-0a0b0c0d0e0f","eventos":[{"tipo":"batimento","versao":"2.00.00"}]}';
  assert.equal(sha256hex(corpo), 'de3761733fe8f894918b991e4207595868e6f715ec5fbeecc8d8ccad3078ed17');
  assert.equal(assinar(s, ts, 'POST', '/api/bot/eventos', corpo), '9423923d6a794b5b175e21dcdb858054fafdbbde7a0c8fc87053df7a78675cd4');
  assert.equal(assinar(s, ts, 'GET', '/api/gateway/fila', ''), '81a751499d7914d98bf8a32bedd305a4209e8e10dac0b00ec2fa8060e2c3d63c');
  assert.equal(
    assinar(s, ts, 'POST', '/acordar', '{"conexaoId":"8f2d6a8e-1111-4b55-9d0f-0a0b0c0d0e0f","motivo":"fila"}'),
    '4fdb4cd5b421cdd4887de940e063f3d8bb51e20c1fec18c4e068c82bc43c24fd',
  );
});

test('verificarAssinatura: aceita a certa; recusa segredo, corpo, caminho, método trocados e fora da janela', () => {
  const ts = String(AGORA);
  const a = assinar(SEGREDO, ts, 'POST', '/acordar', '{"motivo":"fila"}');
  const base = { segredo: SEGREDO, ts, assinatura: a, metodo: 'POST', caminho: '/acordar', corpo: '{"motivo":"fila"}', agora: AGORA };
  assert.equal(verificarAssinatura(base), true);
  assert.equal(verificarAssinatura({ ...base, agora: AGORA + 299_000 }), true);
  assert.equal(verificarAssinatura({ ...base, agora: AGORA + 301_000 }), false);
  assert.equal(verificarAssinatura({ ...base, agora: AGORA - 301_000 }), false);
  assert.equal(verificarAssinatura({ ...base, segredo: 'y'.repeat(64) }), false);
  assert.equal(verificarAssinatura({ ...base, corpo: '{"motivo":"parear"}' }), false);
  assert.equal(verificarAssinatura({ ...base, caminho: '/outra' }), false);
  assert.equal(verificarAssinatura({ ...base, metodo: 'GET' }), false);
  assert.equal(verificarAssinatura({ ...base, assinatura: 'zz' }), false);
  assert.equal(verificarAssinatura({ ...base, ts: undefined }), false);
});

function fetchFalso(resposta = { status: 200, corpo: '{"ok":true}' }) {
  const chamadas = [];
  const f = async (url, init) => {
    chamadas.push({ url: new URL(url), ...init });
    return { ok: resposta.status < 400, status: resposta.status, text: async () => resposta.corpo };
  };
  f.chamadas = chamadas;
  return f;
}

test('transporte do gateway assina cada chamada sobre o corpo exato e o caminho sem query', async () => {
  const f = fetchFalso();
  const t = criarTransporteGateway({ base: 'https://crm.exemplo.com.br/', segredo: SEGREDO, fetch: f, agora: () => AGORA });
  await t.eventos('cx-1', [{ tipo: 'batimento', versao: '2.00.00' }]);
  await t.fila(50);
  await t.conexoes();
  await t.confirmar({ id: 'm1', status: 'enviada', waId: '3EB0X' });

  const [ev, fila, cx, conf] = f.chamadas;
  assert.equal(ev.url.href, 'https://crm.exemplo.com.br/api/bot/eventos');
  assert.deepEqual(JSON.parse(ev.body), { conexaoId: 'cx-1', eventos: [{ tipo: 'batimento', versao: '2.00.00' }] });
  assert.equal(ev.headers['x-gateway-ts'], String(AGORA));
  assert.equal(ev.headers['x-gateway-assinatura'], assinar(SEGREDO, String(AGORA), 'POST', '/api/bot/eventos', ev.body));
  assert.equal(fila.method, 'GET');
  assert.equal(fila.url.search, '?limite=50');
  assert.equal(fila.headers['x-gateway-assinatura'], assinar(SEGREDO, String(AGORA), 'GET', '/api/gateway/fila', ''));
  assert.equal(fila.body, undefined);
  assert.equal(cx.url.pathname, '/api/gateway/conexoes');
  assert.equal(conf.url.pathname, '/api/bot/confirmar');
  for (const c of f.chamadas) assert.equal(c.headers['x-bot-segredo'], undefined);
});

test('transporte do modo PC usa x-bot-conexao + x-bot-segredo e não manda conexaoId no corpo', async () => {
  const f = fetchFalso({ status: 200, corpo: '{"mensagens":[]}' });
  const t = criarTransportePC({ base: 'https://crm.exemplo.com.br', conexaoId: 'cx-9', segredo: 's3gr3d0', fetch: f });
  await t.eventos('ignorado', [{ tipo: 'batimento', versao: '2.00.00' }]);
  await t.fila();
  const [ev, fila] = f.chamadas;
  assert.equal(ev.headers['x-bot-conexao'], 'cx-9');
  assert.equal(ev.headers['x-bot-segredo'], 's3gr3d0');
  assert.deepEqual(JSON.parse(ev.body), { eventos: [{ tipo: 'batimento', versao: '2.00.00' }] });
  assert.equal(fila.url.pathname + fila.url.search, '/api/bot/fila?limite=10');
});

test('erro HTTP carrega o status; base só https (ou localhost); segredo curto é recusado', async () => {
  const t = criarTransporteGateway({ base: 'https://crm.exemplo.com.br', segredo: SEGREDO, fetch: fetchFalso({ status: 401, corpo: '{"erro":"assinatura"}' }) });
  await assert.rejects(t.conexoes(), (e) => e.httpStatus === 401);
  assert.throws(() => validarBase('http://crm.exemplo.com.br'), /https/);
  assert.equal(validarBase('http://localhost:3000/x'), 'http://localhost:3000');
  assert.throws(() => criarTransporteGateway({ base: 'https://a.b', segredo: 'curto' }), /32/);
});

function chamar(porta, { metodo = 'POST', caminho = '/acordar', corpo = '', cabecalhos = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: { 'Content-Type': 'application/json', ...cabecalhos } }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, corpo: b }));
    });
    req.on('error', reject);
    req.end(corpo);
  });
}

test('servidor da campainha: só POST /acordar assinado; repetição, vencida e o resto são recusados', async () => {
  const chamadas = [];
  let relogio = AGORA;
  const srv = criarServidorAcordar({ segredo: SEGREDO, aoAcordar: (p) => { chamadas.push(p); }, agora: () => relogio });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const porta = srv.address().port;
  const assinado = (corpo, ts = String(relogio)) => ({ 'x-gateway-ts': ts, 'x-gateway-assinatura': assinar(SEGREDO, ts, 'POST', '/acordar', corpo) });
  try {
    const corpo = JSON.stringify({ conexaoId: 'cx-1', motivo: 'fila' });
    const h = assinado(corpo);
    assert.equal((await chamar(porta, { corpo, cabecalhos: h })).status, 202);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(chamadas, [{ conexaoId: 'cx-1', motivo: 'fila' }]);

    assert.equal((await chamar(porta, { corpo, cabecalhos: h })).status, 401, 'a mesma campainha não toca duas vezes');
    assert.equal((await chamar(porta, { corpo, cabecalhos: { ...h, 'x-gateway-assinatura': '0'.repeat(64) } })).status, 401);
    relogio += 1;
    const velho = String(AGORA - 400_000);
    assert.equal((await chamar(porta, { corpo, cabecalhos: assinado(corpo, velho) })).status, 401);
    const outroMotivo = JSON.stringify({ conexaoId: 'cx-1', motivo: 'apagar_tudo' });
    assert.equal((await chamar(porta, { corpo: outroMotivo, cabecalhos: assinado(outroMotivo) })).status, 400);
    assert.equal((await chamar(porta, { metodo: 'GET', caminho: '/acordar' })).status, 404);
    assert.equal((await chamar(porta, { caminho: '/api/qualquer', corpo, cabecalhos: assinado(corpo) })).status, 404);
    assert.equal((await chamar(porta, { metodo: 'GET', caminho: '/' })).status, 404);
    const grande = JSON.stringify({ motivo: 'fila', lixo: 'a'.repeat(5000) });
    assert.equal((await chamar(porta, { corpo: grande, cabecalhos: assinado(grande) })).status, 413);
    assert.equal(chamadas.length, 1);
  } finally {
    srv.close();
  }
});
