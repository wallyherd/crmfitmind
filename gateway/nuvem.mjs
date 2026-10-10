// nuvem.mjs — conversa com o CRM: assinatura HMAC (modo gateway), segredo por
// conexão (modo PC) e o servidor mínimo que recebe a "campainha" POST /acordar.
//
// A URL base vem só do ambiente ou do config.json, nunca da rede: no conector
// antigo um campo de URL editável pela rede virava execução remota de código.

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

export const JANELA_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 20_000;

export const sha256hex = (dados) => createHash('sha256').update(dados ?? '').digest('hex');

/** hex(HMAC_SHA256(segredo, ts + '.' + METODO + '.' + caminho_sem_query + '.' + sha256hex(corpo))) */
export function assinar(segredo, ts, metodo, caminho, corpo = '') {
  return createHmac('sha256', segredo)
    .update(`${ts}.${String(metodo).toUpperCase()}.${caminho}.${sha256hex(corpo)}`)
    .digest('hex');
}

/** Confere a assinatura em tempo constante e dentro da janela de 5 minutos. */
export function verificarAssinatura({ segredo, ts, assinatura, metodo, caminho, corpo = '', agora = Date.now() }) {
  if (!segredo || typeof ts !== 'string' || typeof assinatura !== 'string') return false;
  if (!/^\d{10,16}$/.test(ts) || !/^[0-9a-f]{64}$/i.test(assinatura)) return false;
  if (Math.abs(agora - Number(ts)) > JANELA_MS) return false;
  const esperado = Buffer.from(assinar(segredo, ts, metodo, caminho, corpo), 'hex');
  const recebido = Buffer.from(assinatura, 'hex');
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}

/** https sempre, exceto localhost (desenvolvimento). Sem barra no fim. */
export function validarBase(base) {
  let u;
  try { u = new URL(String(base || '')); } catch { throw new Error(`endereço do CRM inválido: "${base}"`); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) {
    throw new Error('o endereço do CRM precisa ser https://');
  }
  return u.origin;
}

/** Erro com o status HTTP junto: quem chama distingue "a rede caiu" de "o CRM recusou isto". */
function erroHttp(status, texto) {
  const e = new Error(`HTTP ${status}: ${String(texto).slice(0, 300)}`);
  e.httpStatus = status;
  return e;
}

async function chamar({ base, fetch: f = globalThis.fetch, metodo, caminho, corpo, cabecalhos }) {
  const url = new URL(caminho, base);
  const textoCorpo = corpo === undefined ? '' : JSON.stringify(corpo);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await f(url, {
      method: metodo,
      signal: ac.signal,
      headers: {
        ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...cabecalhos(metodo, url.pathname, textoCorpo),
      },
      body: corpo === undefined ? undefined : textoCorpo,
    });
    const texto = await res.text();
    if (!res.ok) throw erroHttp(res.status, texto);
    try { return texto ? JSON.parse(texto) : {}; } catch { throw erroHttp(502, 'resposta não é JSON'); }
  } finally {
    clearTimeout(t);
  }
}

const TIMEOUT_MIDIA_MS = 60_000;
const CABECALHO_SEGURO = /^[ -~]{1,120}$/;

/**
 * Sobe um comprovante: o corpo é o arquivo cru (Content-Type = mimetype), com a conexão, o waId e o chatJid em
 * cabeçalhos. A assinatura cobre os bytes do arquivo, como nas outras rotas.
 * Erro com `httpStatus` quando o CRM respondeu; sem ele, a rede caiu.
 */
async function subirMidia({ base, fetch: f = globalThis.fetch, cabecalhos, conexaoId, waId, chatJid, mimetype, corpo }) {
  if (!Buffer.isBuffer(corpo) || !corpo.length) throw erroHttp(400, 'arquivo vazio');
  for (const v of [waId, chatJid]) if (!CABECALHO_SEGURO.test(String(v ?? ''))) throw erroHttp(400, 'cabeçalho inválido');
  const url = new URL('/api/gateway/midia', base);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MIDIA_MS);
  try {
    const res = await f(url, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': mimetype,
        ...(conexaoId ? { 'x-conexao-id': conexaoId } : {}),
        'x-wa-id': waId,
        'x-chat-jid': chatJid,
        ...cabecalhos('POST', url.pathname, corpo),
      },
      body: corpo,
    });
    const texto = await res.text();
    if (!res.ok) throw erroHttp(res.status, texto);
    try { return texto ? JSON.parse(texto) : {}; } catch { throw erroHttp(502, 'resposta não é JSON'); }
  } finally {
    clearTimeout(t);
  }
}

/**
 * Transporte do modo gateway: cada chamada assinada com o GATEWAY_SECRET.
 * @param {{ base: string, segredo: string, fetch?: typeof fetch, agora?: () => number }} op
 */
export function criarTransporteGateway({ base, segredo, fetch, agora = Date.now }) {
  base = validarBase(base);
  if (!segredo || String(segredo).length < 32) throw new Error('GATEWAY_SECRET precisa ter pelo menos 32 caracteres');
  const cabecalhos = (metodo, caminho, corpo) => {
    const ts = String(agora());
    return { 'x-gateway-ts': ts, 'x-gateway-assinatura': assinar(segredo, ts, metodo, caminho, corpo) };
  };
  const c = (metodo, caminho, corpo) => chamar({ base, fetch, metodo, caminho, corpo, cabecalhos });
  return {
    modo: 'gateway',
    eventos: (conexaoId, eventos) => c('POST', '/api/bot/eventos', { conexaoId, eventos }),
    confirmar: (dados) => c('POST', '/api/bot/confirmar', dados),
    conexoes: () => c('GET', '/api/gateway/conexoes'),
    fila: (limite = 50) => c('GET', `/api/gateway/fila?limite=${Number(limite) || 50}`),
    midia: (dados) => subirMidia({ base, fetch, cabecalhos, ...dados }),
  };
}

/**
 * Transporte do modo PC: uma conexão só, autenticada por x-bot-conexao + x-bot-segredo.
 * @param {{ base: string, conexaoId: string, segredo: string, fetch?: typeof fetch }} op
 */
export function criarTransportePC({ base, conexaoId, segredo, fetch }) {
  base = validarBase(base);
  const cabecalhos = () => ({ 'x-bot-conexao': conexaoId, 'x-bot-segredo': segredo });
  const c = (metodo, caminho, corpo) => chamar({ base, fetch, metodo, caminho, corpo, cabecalhos });
  return {
    modo: 'pc',
    eventos: (_conexaoId, eventos) => c('POST', '/api/bot/eventos', { eventos }),
    confirmar: (dados) => c('POST', '/api/bot/confirmar', dados),
    fila: (limite = 10) => c('GET', `/api/bot/fila?limite=${Number(limite) || 10}`),
    midia: (dados) => subirMidia({ base, fetch, cabecalhos, ...dados, conexaoId: undefined }),
  };
}

export const MOTIVOS_ACORDAR = new Set(['fila', 'parear', 'desconectar', 'opcoes']);
const MAX_CORPO_ACORDAR = 4096;

/**
 * Servidor HTTP que só responde POST /acordar com assinatura válida. Todo o resto é 404.
 * A campainha não carrega conteúdo: só diz "olhe a fila" ou "olhe as conexões";
 * o gateway busca o resto pelas rotas autenticadas.
 * @param {{ segredo: string, aoAcordar: (p: {conexaoId: string|null, motivo: string}) => any,
 *           log?: Function, agora?: () => number }} op
 */
export function criarServidorAcordar({ segredo, aoAcordar, log = () => {}, agora = Date.now }) {
  const vistas = new Map(); // assinatura -> expira: a mesma campainha não toca duas vezes
  const responder = (res, status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(obj ? JSON.stringify(obj) : '');
  };
  return createServer((req, res) => {
    const caminho = String(req.url || '').split('?')[0];
    if (req.method !== 'POST' || caminho !== '/acordar') {
      req.resume();
      return responder(res, 404, { erro: 'nao_encontrado' });
    }
    const pedacos = [];
    let tamanho = 0;
    let estourou = false;
    req.on('data', (p) => {
      tamanho += p.length;
      if (tamanho > MAX_CORPO_ACORDAR) estourou = true;
      else pedacos.push(p);
    });
    req.on('error', () => {});
    req.on('end', () => {
      if (estourou) return responder(res, 413, { erro: 'corpo_grande' });
      const corpo = Buffer.concat(pedacos);
      const ts = req.headers['x-gateway-ts'];
      const assinatura = req.headers['x-gateway-assinatura'];
      const ok = verificarAssinatura({ segredo, ts, assinatura, metodo: 'POST', caminho, corpo, agora: agora() });
      const t = agora();
      for (const [a, exp] of vistas) if (exp < t) vistas.delete(a);
      if (!ok || vistas.has(String(assinatura).toLowerCase())) {
        log('campainha recusada (assinatura inválida, vencida ou repetida)', 'aviso');
        return responder(res, 401, { erro: 'assinatura' });
      }
      vistas.set(String(assinatura).toLowerCase(), t + 2 * JANELA_MS);
      let dados;
      try { dados = JSON.parse(corpo.toString('utf8') || '{}'); } catch { return responder(res, 400, { erro: 'json' }); }
      const motivo = String(dados?.motivo || '');
      const conexaoId = dados?.conexaoId == null ? null : String(dados.conexaoId).slice(0, 64);
      if (!MOTIVOS_ACORDAR.has(motivo)) return responder(res, 400, { erro: 'motivo' });
      responder(res, 202, { ok: true });
      Promise.resolve()
        .then(() => aoAcordar({ conexaoId, motivo }))
        .catch((e) => log(`campainha: ${e.message}`, 'erro'));
    });
  });
}
