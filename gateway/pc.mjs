// pc.mjs — modo PC: uma sessão só, no computador do mentorado, com painel local.
//
//   node pc.mjs        (ou dois cliques no iniciar.bat)
//   painel: http://127.0.0.1:3100
//
// Serve para o piloto e para quem não pode ficar no VPS (ex.: número que precisa
// do IP da própria casa). Autentica com x-bot-conexao + x-bot-segredo, que o CRM
// mostra na tela da conexão. O endereço do CRM só muda editando o config.json ou
// pela variável CRM_BASE: o painel não mexe nele (no conector antigo, mexia, e
// isso permitia apontar o conector para um servidor qualquer).

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sessao, VERSAO } from './sessao.mjs';
import { criarTransportePC, validarBase } from './nuvem.mjs';
import { gravarAtomico } from './spool.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PASTA = process.env.PASTA_PC || AQUI;
const ARQ_CONFIG = join(PASTA, 'config.json');
const PORTA = Number(process.env.PORT || 3100);
const BASE_PADRAO = 'https://crm-fitmind-whatsapp.vercel.app';

/* ---------------- registro ---------------- */

const registro = [];
function log(texto, tipo = 'info') {
  const linha = { em: new Date().toISOString(), tipo, texto: String(texto) };
  registro.unshift(linha);
  if (registro.length > 200) registro.pop();
  console.log(`[${linha.em.slice(11, 19)}] ${tipo === 'info' ? '' : `${tipo}: `}${linha.texto}`);
}

/* ---------------- configuração ---------------- */

let config = { conexaoId: '', segredo: '', base: '', botAtivo: false, gruposPermitidos: [], historicoDias: 7 };

async function carregarConfig() {
  try {
    config = { ...config, ...JSON.parse(await readFile(ARQ_CONFIG, 'utf8')) };
  } catch (e) {
    if (e.code !== 'ENOENT') log(`config.json ilegível: ${e.message}`, 'erro');
  }
  config.base = validarBase(process.env.CRM_BASE || config.base || BASE_PADRAO);
}
const salvarConfig = () => gravarAtomico(ARQ_CONFIG, JSON.stringify(config, null, 2));
const configurado = () => !!(config.conexaoId && config.segredo);

/* ---------------- sessão ---------------- */

let sessao = null;
let transporte = null;
let nuvem = 'sem_teste';
let qrDataUrl = null;

/** Transporte que também acende a luz "nuvem" do painel. */
function observar(t) {
  const marcar = (p) => p.then((r) => { nuvem = 'ok'; return r; }, (e) => { nuvem = 'falha'; throw e; });
  return { ...t, eventos: (...a) => marcar(t.eventos(...a)), confirmar: (...a) => marcar(t.confirmar(...a)), fila: (...a) => marcar(t.fila(...a)) };
}

async function montarSessao() {
  if (sessao) await sessao.parar('reconfigurada').catch(() => {});
  qrDataUrl = null;
  transporte = observar(criarTransportePC({ base: config.base, conexaoId: config.conexaoId, segredo: config.segredo }));
  sessao = new Sessao(config.conexaoId, {
    gruposPermitidos: config.gruposPermitidos, historicoDias: config.historicoDias, botAtivo: config.botAtivo === true,
  }, transporte, { pasta: join(PASTA, 'dados-pc'), log });
  sessao.on('qr', async (qr) => {
    try {
      const QRCode = (await import('qrcode')).default;
      qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
    } catch (e) { log(`não consegui desenhar o QR: ${e.message}`, 'erro'); }
  });
  sessao.on('estado', (e) => { if (e.conexao !== 'aguardando_qr') qrDataUrl = null; });
  sessao.on('fim', ({ motivo }) => log(`sessão parada: ${motivo}${motivo === 'precisa_parear' ? ' — use "Conectar" no painel' : ''}`, 'aviso'));
  await sessao.iniciar();
}

/* ---------------- fila de saída: polling adaptativo ---------------- */

// 5 s com movimento nos últimos 10 min, 20 s parado. Só com o robô ligado.
let ultimoMovimento = 0;
let ultimasRecebidas = 0;
async function cicloFila() {
  try {
    if (sessao && config.botAtivo === true && sessao.estado.conexao === 'conectado') {
      if (sessao.estado.recebidas !== ultimasRecebidas) { ultimasRecebidas = sessao.estado.recebidas; ultimoMovimento = Date.now(); }
      const r = await transporte.fila(10);
      const mensagens = Array.isArray(r?.mensagens) ? r.mensagens : [];
      if (mensagens.length) {
        ultimoMovimento = Date.now();
        await sessao.enfileirarEnvio(mensagens);
      }
    }
  } catch (e) {
    log(`fila: ${e.message}`, 'aviso');
  } finally {
    setTimeout(() => void cicloFila(), Date.now() - ultimoMovimento < 600_000 ? 5000 : 20_000);
  }
}

/* ---------------- painel local ---------------- */

const HOSTS_OK = new Set([`127.0.0.1:${PORTA}`, `localhost:${PORTA}`]);

const responder = (res, codigo, obj) => {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};

function lerCorpo(req, limite = 16_384) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > limite) { resolve(null); req.destroy(); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
    req.on('close', () => resolve(null)); // sem efeito se já resolveu
  });
}

const painel = createServer(async (req, res) => {
  // DNS rebinding: só aceita quem chama pelo nome local.
  if (!HOSTS_OK.has(String(req.headers.host || ''))) return responder(res, 403, { erro: 'host' });
  if (req.method !== 'GET') {
    const origem = req.headers.origin;
    if (origem && !HOSTS_OK.has(String(origem).replace(/^https?:\/\//, ''))) return responder(res, 403, { erro: 'origem' });
    // text/plain passa cross-origin sem preflight; exigir JSON fecha o CSRF.
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return responder(res, 415, { erro: 'json' });
  }
  const url = new URL(req.url, `http://127.0.0.1:${PORTA}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/painel.html')) {
    const html = await readFile(join(AQUI, 'painel.html'), 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
    });
    return res.end(html);
  }

  if (req.method === 'GET' && url.pathname === '/api/estado') {
    const e = sessao?.estado || { conexao: 'parada', detalhe: '', numero: null, codigo: null, recebidas: 0, enviadas: 0, naFilaLocal: 0 };
    return responder(res, 200, {
      versao: VERSAO,
      conexao: e.conexao, detalhe: e.detalhe, numero: e.numero, codigo: e.codigo,
      recebidas: e.recebidas, enviadas: e.enviadas, naFilaLocal: e.naFilaLocal,
      qrDataUrl: e.conexao === 'aguardando_qr' ? qrDataUrl : null,
      nuvem, configurado: configurado(), conexaoId: config.conexaoId, envioLigado: config.botAtivo === true,
      registro: registro.slice(0, 40),
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/config') {
    const b = await lerCorpo(req);
    if (!b) return responder(res, 400, { ok: false, erro: 'json inválido' });
    const conexaoId = String(b.conexaoId || '').trim();
    const segredo = String(b.segredo || '').trim();
    if (!/^[A-Za-z0-9-]{1,64}$/.test(conexaoId)) return responder(res, 400, { ok: false, erro: 'identificador inválido' });
    if (!segredo && conexaoId !== config.conexaoId) return responder(res, 400, { ok: false, erro: 'falta o segredo' });
    config.conexaoId = conexaoId;
    if (segredo) config.segredo = segredo;
    await salvarConfig();
    log('configuração salva', 'ok');
    await montarSessao();
    return responder(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/parear') {
    if (!sessao) return responder(res, 409, { ok: false, erro: 'configure a conexão primeiro' });
    const b = (await lerCorpo(req)) || {};
    const metodo = b.metodo === 'codigo' ? 'codigo' : 'qr';
    if (metodo === 'codigo' && String(b.telefone || '').replace(/\D/g, '').length < 10) {
      return responder(res, 400, { ok: false, erro: 'informe o número com DDD' });
    }
    // Já pareada mas parada (erro, ou queda que ainda não religou): religa com a sessão salva.
    if (sessao.pareado) await montarSessao();
    else await sessao.parear({ metodo, telefone: b.telefone || null });
    return responder(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/desconectar') {
    if (!sessao) return responder(res, 409, { ok: false, erro: 'nada conectado' });
    await sessao.desconectar();
    log('WhatsApp desconectado e sessão apagada deste computador', 'ok');
    return responder(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/testar-nuvem') {
    if (!transporte) return responder(res, 409, { ok: false, erro: 'configure a conexão primeiro' });
    try {
      await transporte.eventos(config.conexaoId, [{ tipo: 'batimento', versao: VERSAO }]);
      log('teste do CRM: ok', 'ok');
      return responder(res, 200, { ok: true });
    } catch (e) {
      log(`teste do CRM falhou: ${e.message}`, 'erro');
      return responder(res, 200, { ok: false, erro: e.message });
    }
  }

  return responder(res, 404, { erro: 'rota nao encontrada' });
});

/* ---------------- sobe ---------------- */

await carregarConfig();
painel.on('error', (e) => { console.error(`painel: ${e.message}`); process.exit(1); });
painel.listen(PORTA, '127.0.0.1', () => {
  console.log('');
  console.log(`  Conector de WhatsApp do CRM (modo PC) ${VERSAO}`);
  console.log(`  Painel: http://127.0.0.1:${PORTA}`);
  console.log(`  CRM: ${config.base}`);
  console.log('  Deixe esta janela aberta. Para encerrar, feche a janela.');
  console.log('');
});

if (configurado()) await montarSessao();
else log('cole o identificador e o segredo da conexão no painel para começar', 'aviso');
void cicloFila();

let encerrando = false;
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    if (encerrando) return;
    encerrando = true;
    void (async () => { try { await sessao?.parar(); } finally { process.exit(0); } })();
  });
}
process.on('unhandledRejection', (e) => log(`promessa sem tratamento: ${e?.message || e}`, 'aviso'));
