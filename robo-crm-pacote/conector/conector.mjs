// conector.mjs — Conector de WhatsApp da FitMind, para rodar no PC da academia.
//
// O que ele faz:
//   1. mantém a sessão do WhatsApp viva (reconecta sozinho)
//   2. quando chega mensagem, manda para a FitMind
//   3. busca a fila de respostas na FitMind e envia
//   4. abre um painel local em http://localhost:3100 para ler o QR e ver o estado
//
// Por que ele "busca" em vez de receber: este PC fica atrás do roteador da
// academia, sem IP fixo. A nuvem não alcança ele. Todas as conexões saem daqui.
//
// Se a internet cair, as mensagens recebidas ficam guardadas em fila local
// (pendentes.json) e sobem quando a conexão voltar. Nada se perde.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ARQ_CONFIG = join(AQUI, 'config.json');
const ARQ_SPOOL = join(AQUI, 'pendentes.json');
const PASTA_SESSAO = join(AQUI, 'sessao');
const PORTA = Number(process.env.PORT || 3100);
const INTERVALO_FILA = Number(process.env.INTERVALO || 3000);

/*
 * A versao tem que ter DOIS DIGITOS em cada parte.
 *
 * A comparacao na nuvem e textual: sem os zeros, "1.9.0" pareceria maior que
 * "1.10.0" e o conector pararia de se atualizar sem ninguem perceber.
 */
const VERSAO = '1.03.00';
const INTERVALO_ATUALIZACAO = 10 * 60 * 1000;

/**
 * So estes arquivos podem ser escritos por uma atualizacao.
 *
 * A lista existe para que uma resposta adulterada nao consiga criar um .bat no
 * autostart, sobrescrever o node.exe, nem tocar em config.json (que guarda o
 * segredo) ou na pasta sessao (que e a sessao do WhatsApp). Atualizacao e
 * codigo nosso, nao um canal para gravar qualquer coisa no PC da academia.
 */
const ARQUIVOS_DA_ATUALIZACAO = new Set(['conector.mjs', 'painel.html']);

/*
 * Uma rodada de fila por vez.
 *
 * O setInterval dispara a cada 3s, mas uma rodada demora mais: o "digitando"
 * sozinho leva ate 6s por mensagem. Sem esta trava, a rodada seguinte comecava
 * por cima da anterior, buscava a MESMA mensagem ainda pendente e mandava de
 * novo. Em 26/08 uma mensagem so saiu quatro vezes, as 7:38:34, :35, :36 e :39.
 * Para o cliente isso seria a mesma cobranca chegando quatro vezes.
 *
 * Fica aqui em cima, e nao junto da fila, porque a auto-atualizacao tambem
 * consulta esta trava para nao reiniciar no meio de um envio.
 */
let rodandoFila = false;

// ---------- estado em memória ----------
const estado = {
  conexao: 'iniciando',   // iniciando | aguardando_qr | conectado | desconectado | erro
  detalhe: '',
  numero: null,
  qrDataUrl: null,
  nuvem: 'sem_teste',     // ok | falha | sem_teste
  recebidas: 0,
  enviadas: 0,
  naFilaLocal: 0,
  ultimoEvento: null,
};

const registro = [];
function log(texto, tipo = 'info') {
  const linha = { em: new Date().toISOString(), tipo, texto };
  registro.unshift(linha);
  if (registro.length > 200) registro.pop();
  estado.ultimoEvento = linha;
  console.log(`[${linha.em.slice(11, 19)}] ${texto}`);
}

// ---------- configuração ----------
let config = { base: '', conexaoId: '', segredo: '' };

async function carregarConfig() {
  if (existsSync(ARQ_CONFIG)) {
    try {
      config = { ...config, ...JSON.parse(await readFile(ARQ_CONFIG, 'utf8')) };
    } catch (e) {
      log(`config.json ilegível: ${e.message}`, 'erro');
    }
  }
}
async function salvarConfig() {
  await writeFile(ARQ_CONFIG, JSON.stringify(config, null, 2), 'utf8');
}
const configurado = () => !!(config.base && config.conexaoId && config.segredo);

// ---------- fila local (rede caiu) ----------
let spool = [];
async function carregarSpool() {
  if (!existsSync(ARQ_SPOOL)) return;
  try { spool = JSON.parse(await readFile(ARQ_SPOOL, 'utf8')); } catch { spool = []; }
  estado.naFilaLocal = spool.length;
}
async function salvarSpool() {
  estado.naFilaLocal = spool.length;
  await writeFile(ARQ_SPOOL, JSON.stringify(spool), 'utf8');
}

// ---------- conversa com a FitMind ----------
async function chamarNuvem(caminho, { metodo = 'POST', corpo } = {}) {
  if (!configurado()) throw new Error('conector ainda não configurado');
  const url = new URL(caminho, config.base);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: metodo,
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-bot-conexao': config.conexaoId,
        'x-bot-segredo': config.segredo,
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const texto = await res.text();
    let dados; try { dados = texto ? JSON.parse(texto) : {}; } catch { dados = { bruto: texto }; }
    if (!res.ok) {
      // O status vai junto do erro porque quem chama precisa distinguir
      // "a internet caiu" de "a nuvem recusou ISTO". A primeira se resolve
      // repetindo; a segunda, nunca.
      const err = new Error(`HTTP ${res.status}: ${texto.slice(0, 200)}`);
      err.httpStatus = res.status;
      throw err;
    }
    estado.nuvem = 'ok';
    return dados;
  } catch (e) {
    estado.nuvem = 'falha';
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/*
 * Quantas vezes um evento pode falhar antes de ser descartado.
 *
 * A fila local existe para atravessar queda de internet, que dura minutos. Um
 * evento que falhou 20 ciclos seguidos nao esta esperando a internet voltar:
 * ele nunca vai ser aceito, e cada ciclo gasta uma chamada tentando.
 */
const MAX_TENTATIVAS_SPOOL = 20;

/** Recusa definitiva: repetir nao muda o resultado. */
const recusaDefinitiva = (e) => e?.httpStatus >= 400 && e?.httpStatus < 500;

/** Envia um evento para a FitMind; se falhar, guarda na fila local. */
async function enviarEvento(evento) {
  try {
    await chamarNuvem('/api/bot/eventos', { corpo: evento });
    return true;
  } catch (e) {
    if (recusaDefinitiva(e)) {
      // Guardar isto seria guardar lixo que entope a fila para sempre.
      log(`nuvem recusou o evento e nao vai mudar de ideia, descartei: ${e.message}`, 'erro');
      return false;
    }
    spool.push(evento);
    await salvarSpool();
    log(`nuvem fora do ar, guardei na fila local (${spool.length}): ${e.message}`, 'aviso');
    return false;
  }
}

/*
 * Tenta subir o que ficou preso enquanto a internet estava fora.
 *
 * Antes isto dava `break` no primeiro erro. Um unico evento que a nuvem sempre
 * recusa ficava na cabeca da fila e travava TODOS os outros atras dele, para
 * sempre, sem nenhum sinal na tela. Foi exatamente o que aconteceu em 27/08:
 * a rota devolvia 500 numa colisao de conversa, e o robo da academia parou.
 *
 * Agora cada evento e julgado sozinho: recusa definitiva sai da fila, falha de
 * rede conta tentativa, e o laco segue para o proximo em vez de parar.
 */
async function drenarSpool() {
  if (!spool.length || !configurado()) return;
  const pendentes = [...spool];
  const restantes = [];
  let subiram = 0;
  let descartados = 0;

  for (const evento of pendentes) {
    try {
      await chamarNuvem('/api/bot/eventos', { corpo: evento });
      subiram++;
    } catch (e) {
      if (recusaDefinitiva(e)) {
        descartados++;
        log(`descartei evento recusado pela nuvem: ${e.message}`, 'erro');
        continue;
      }
      const tentativas = (evento._tentativas || 0) + 1;
      if (tentativas >= MAX_TENTATIVAS_SPOOL) {
        descartados++;
        log(`desisti de um evento apos ${tentativas} tentativas: ${e.message}`, 'erro');
        continue;
      }
      restantes.push({ ...evento, _tentativas: tentativas });
    }
  }

  spool.length = 0;
  spool.push(...restantes);
  await salvarSpool();
  if (subiram) log(`fila local: ${subiram} subiram, ${descartados} descartados, ${spool.length} esperando`, 'ok');
}

// ---------- WhatsApp ----------
let sock = null;
let reconectando = false;

const soDigitos = (s) => String(s || '').replace(/\D/g, '');
/**
 * Descobre o JID REAL do numero, perguntando ao WhatsApp.
 *
 * Antes era `${soDigitos(telefone)}@s.whatsapp.net`. O telefone chega do CRM e
 * da academia como "(65) 9 9999-0000" -> 65999990000, SEM o 55 do pais. Isso
 * monta um JID que nao existe, e o Baileys manda para o vazio sem reclamar: o
 * registro dizia "enviado", o cliente nunca recebia, e ninguem tinha como
 * saber. Aconteceu em 26/08 as 7:39, no primeiro disparo de verdade.
 *
 * Perguntar em vez de adivinhar resolve tres coisas de uma vez: o 55, o nono
 * digito (que varia entre numeros antigos e novos), e o caso de a pessoa
 * simplesmente nao ter WhatsApp -- que agora vira ERRO de verdade em vez de
 * uma mensagem registrada como enviada que ninguem recebeu.
 */
async function jidDeVerdade(telefone) {
  const so = soDigitos(telefone);
  if (!so) throw new Error('telefone vazio');

  const formatos = so.startsWith('55') ? [so, so.slice(2)] : ['55' + so, so];
  for (const numero of formatos) {
    try {
      const [achado] = await sock.onWhatsApp(numero);
      if (achado?.exists && achado.jid) return achado.jid;
    } catch {
      // a consulta falhou; tenta o proximo formato
    }
  }
  throw new Error(`o numero ${telefone} nao tem WhatsApp`);
}

const logSilencioso = {
  level: 'silent',
  child: () => logSilencioso,
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
};

async function conectarWhatsApp() {
  if (reconectando) return;
  reconectando = true;
  try {
    await mkdir(PASTA_SESSAO, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(PASTA_SESSAO);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false, // o QR aparece no painel local, nao no terminal
      logger: logSilencioso,
      browser: ['FitMind', 'Chrome', '1.0.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (atualizacao) => {
      const { connection, lastDisconnect, qr } = atualizacao;

      if (qr) {
        estado.conexao = 'aguardando_qr';
        estado.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
        log('QR pronto — abra o painel e leia com o WhatsApp do numero da academia', 'aviso');
        void enviarEvento({ tipo: 'status', status: 'aguardando_qr' });
      }

      if (connection === 'open') {
        estado.conexao = 'conectado';
        estado.qrDataUrl = null;
        estado.detalhe = '';
        estado.numero = soDigitos(sock?.user?.id?.split(':')[0]);
        log(`conectado como ${estado.numero}`, 'ok');
        void enviarEvento({ tipo: 'status', status: 'conectado', numero: estado.numero });
      }

      if (connection === 'close') {
        const codigo = lastDisconnect?.error?.output?.statusCode;
        const deslogado = codigo === DisconnectReason.loggedOut;
        estado.conexao = deslogado ? 'desconectado' : 'erro';
        estado.detalhe = deslogado
          ? 'sessao encerrada no celular — precisa ler o QR de novo'
          : `queda de conexao (codigo ${codigo ?? '?'})`;
        log(`conexao caiu: ${estado.detalhe}`, deslogado ? 'erro' : 'aviso');
        void enviarEvento({ tipo: 'status', status: deslogado ? 'desconectado' : 'erro', detalhe: estado.detalhe });

        reconectando = false;
        if (deslogado) return; // sessao invalida: apagar a pasta 'sessao' e reiniciar
        setTimeout(() => void conectarWhatsApp(), 5000);
        return;
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const m of messages) {
        if (m.key?.fromMe) continue;
        const jid = m.key?.remoteJid || '';
        if (jid.endsWith('@g.us')) continue;      // ignora grupos
        if (jid === 'status@broadcast') continue; // ignora status

        const corpo =
          m.message?.conversation ||
          m.message?.extendedTextMessage?.text ||
          m.message?.imageMessage?.caption ||
          '';
        const tipo =
          m.message?.imageMessage ? 'imagem' :
          m.message?.audioMessage ? 'audio' :
          m.message?.videoMessage ? 'video' :
          m.message?.documentMessage ? 'documento' : 'texto';

        /*
         * O endereco pode nao ser um telefone.
         *
         * O WhatsApp passou a enderecar parte das conversas por LID
         * (103843987759126@lid). Guardar so os digitos disso fazia a resposta
         * sair para um numero que nao existe -- foi o que aconteceu em 26/08.
         *
         * Entao: manda o JID inteiro, que e o endereco de volta garantido, e
         * o telefone quando der para saber. O Baileys costuma trazer o par
         * telefone/LID em remoteJidAlt.
         */
        const alt = m.key?.remoteJidAlt || m.key?.participantAlt || '';
        const ehTelefone = (x) => /@s\.whatsapp\.net$/.test(String(x || ''));
        const numero = ehTelefone(jid) ? soDigitos(jid)
          : ehTelefone(alt) ? soDigitos(alt)
          : soDigitos(alt || jid);

        estado.recebidas++;
        log(`recebido de ${numero}: ${corpo.slice(0, 60) || `(${tipo})`}`);

        await enviarEvento({
          tipo: 'mensagem',
          telefone: numero,
          jid,
          nome: m.pushName || null,
          corpo,
          tipoMidia: tipo,
          waId: m.key?.id || null,
          em: new Date((Number(m.messageTimestamp) || Date.now() / 1000) * 1000).toISOString(),
        });
      }
    });
  } catch (e) {
    estado.conexao = 'erro';
    estado.detalhe = e.message;
    log(`falha ao conectar: ${e.message}`, 'erro');
    reconectando = false;
    setTimeout(() => void conectarWhatsApp(), 10000);
  }
}

/**
 * Mostra "digitando..." antes de mandar, pelo tempo que uma pessoa levaria.
 *
 * Nao e enfeite. Mensagem que aparece pronta, no mesmo segundo, para dezenas de
 * numeros e o padrao que o WhatsApp usa para identificar robo — e chip
 * bloqueado nao manda mais nada para ninguem. O espacamento ENTRE mensagens ja
 * vem da campanha (intervalo_segundos); isto aqui e o comportamento DENTRO de
 * cada uma.
 *
 * O tempo acompanha o tamanho do texto, com teto: ninguem fica dez segundos
 * digitando "Bom dia", e ninguem digita um paragrafo em meio segundo.
 */
async function mostrarDigitando(jid, texto) {
  const MIN = 1200, MAX = 6000, POR_CARACTERE = 45;
  const tempo = Math.min(MAX, Math.max(MIN, String(texto || '').length * POR_CARACTERE));
  try {
    await sock.presenceSubscribe(jid);
    await sock.sendPresenceUpdate('composing', jid);
    await new Promise((r) => setTimeout(r, tempo));
    await sock.sendPresenceUpdate('paused', jid);
  } catch {
    // Presenca e cortesia: se o WhatsApp recusar, a mensagem ainda vai. Falhar
    // o envio por causa do "digitando" seria trocar o essencial pelo enfeite.
  }
}

// ---------- auto-atualizacao ----------

/**
 * Pergunta a nuvem se existe versao mais nova e, se existir, aplica e reinicia.
 *
 * Ate a 1.00.00 cada correcao exigia alguem copiar um arquivo no PC da
 * academia. Em 26/08 sairam tres correcoes no mesmo dia -- JID sem o 55, envio
 * em duplicata, alvo travado em "enfileirado" -- e todas dependiam disso.
 *
 * O lancador (FitMindConector.exe) ja reiniciava no codigo de saida 42 desde a
 * primeira versao. Faltava so o programa saber quando pedir.
 */
async function verificarAtualizacao() {
  if (!configurado()) return false;
  // Nunca no meio de um envio: reiniciar ali deixaria a mensagem sem
  // confirmacao, e ela voltaria para a fila e sairia duas vezes.
  if (rodandoFila) return false;

  let r;
  try {
    r = await chamarNuvem(`/api/bot/atualizacao?versao=${VERSAO}`, { metodo: 'GET' });
  } catch {
    return false; // nuvem fora; tenta no proximo ciclo
  }
  if (!r?.novidade || !r.arquivos) return false;

  let mudou = 0;
  const ignorados = [];
  for (const [rel, conteudo] of Object.entries(r.arquivos)) {
    if (!ARQUIVOS_DA_ATUALIZACAO.has(rel) || typeof conteudo !== 'string') {
      ignorados.push(rel);
      continue;
    }
    const destino = join(AQUI, rel);
    // Nao reescreve o que ja esta igual: evita reinicio a toa.
    try {
      if (existsSync(destino) && await readFile(destino, 'utf8') === conteudo) continue;
    } catch { /* ilegivel: sobrescreve */ }

    // .tmp e rename: queda de energia no meio nao deixa arquivo pela metade.
    const tmp = `${destino}.tmp`;
    await writeFile(tmp, conteudo, 'utf8');
    await rename(tmp, destino);
    mudou += 1;
  }

  if (ignorados.length) log(`atualizacao ${r.versao}: ignorei ${ignorados.join(', ')}`, 'erro');
  if (!mudou) return false;

  log(`atualizado para ${r.versao}; reiniciando`, 'ok');
  // 42 e o combinado com o lancador.
  setTimeout(() => process.exit(42), 500);
  return true;
}

setInterval(() => { void verificarAtualizacao(); }, INTERVALO_ATUALIZACAO);

// ---------- fila de saida (a nuvem nao nos alcanca, entao buscamos) ----------

async function processarFila() {
  if (rodandoFila) return;
  if (!configurado() || estado.conexao !== 'conectado') return;
  rodandoFila = true;
  try {
    await processarFilaAgora();
  } finally {
    rodandoFila = false;
  }
}

async function processarFilaAgora() {
  let fila;
  try {
    fila = await chamarNuvem(`/api/bot/fila?limite=10`, { metodo: 'GET' });
  } catch {
    return; // nuvem fora; tenta no proximo ciclo
  }
  for (const msg of fila.mensagens || []) {
    try {
      /*
       * Endereco de volta, quando a conversa tem um.
       *
       * Responder ao MESMO endereco de onde a mensagem veio dispensa adivinhar
       * formato -- vale para telefone, para LID e para o que o WhatsApp
       * inventar depois. So campanha, que nasce de um cadastro e nao de uma
       * conversa, precisa resolver o numero.
       */
      const jid = msg.jid || await jidDeVerdade(msg.telefone);
      await mostrarDigitando(jid, msg.corpo);
      const r = await sock.sendMessage(jid, { text: msg.corpo });
      estado.enviadas++;
      log(`enviado para ${msg.telefone}: ${String(msg.corpo).slice(0, 60)}`);
      await chamarNuvem('/api/bot/confirmar', {
        corpo: { id: msg.id, status: 'enviada', waId: r?.key?.id || null },
      });
    } catch (e) {
      log(`falha ao enviar para ${msg.telefone}: ${e.message}`, 'erro');
      try {
        await chamarNuvem('/api/bot/confirmar', {
          corpo: { id: msg.id, status: 'erro', erro: e.message.slice(0, 300) },
        });
      } catch { /* nuvem fora; a mensagem continua pendente la */ }
    }
  }
}

setInterval(() => { void processarFila(); }, INTERVALO_FILA);
setInterval(() => { void drenarSpool(); }, 15000);
// batimento: avisa a nuvem que este PC esta vivo
setInterval(() => {
  if (configurado() && estado.conexao === 'conectado') {
    void chamarNuvem('/api/bot/eventos', { corpo: { tipo: 'batimento' } }).catch(() => {});
  }
}, 60000);

// ---------- painel local ----------
const responder = (res, codigo, obj) => {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

function lerCorpo(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}

const painel = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORTA}`);

  if (url.pathname === '/' || url.pathname === '/painel.html') {
    const html = await readFile(join(AQUI, 'painel.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  if (url.pathname === '/api/estado') {
    return responder(res, 200, {
      ...estado,
      configurado: configurado(),
      base: config.base,
      conexaoId: config.conexaoId,
      registro: registro.slice(0, 40),
    });
  }

  if (url.pathname === '/api/config' && req.method === 'POST') {
    const b = await lerCorpo(req);
    config.base = String(b.base || '').trim().replace(/\/$/, '');
    config.conexaoId = String(b.conexaoId || '').trim();
    config.segredo = String(b.segredo || '').trim();
    await salvarConfig();
    log('configuracao salva', 'ok');
    if (estado.conexao === 'iniciando' || estado.conexao === 'erro') void conectarWhatsApp();
    return responder(res, 200, { ok: true });
  }

  if (url.pathname === '/api/testar-nuvem' && req.method === 'POST') {
    try {
      const r = await chamarNuvem('/api/bot/eventos', { corpo: { tipo: 'teste' } });
      log('teste de nuvem: ok', 'ok');
      return responder(res, 200, { ok: true, resposta: r });
    } catch (e) {
      log(`teste de nuvem falhou: ${e.message}`, 'erro');
      return responder(res, 200, { ok: false, erro: e.message });
    }
  }

  return responder(res, 404, { erro: 'rota nao encontrada' });
});

// ---------- sobe ----------
await carregarConfig();
await carregarSpool();

painel.listen(PORTA, () => {
  console.log('');
  console.log('  Conector de WhatsApp — FitMind');
  console.log(`  Painel: http://localhost:${PORTA}`);
  console.log('');
  console.log('  Deixe esta janela aberta. Para encerrar, feche a janela.');
  console.log('');
});

if (configurado()) {
  void conectarWhatsApp();
} else {
  estado.conexao = 'iniciando';
  log('configure a conexao no painel para comecar', 'aviso');
}
