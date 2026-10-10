// sessao.mjs — uma sessão do WhatsApp (Baileys) ligada ao CRM.
//
// Nasceu do conector 1.03.00 do robo-crm-pacote. Mudou o que importa:
//   - captura tudo: o que o mentorado digita no celular, grupos marcados, o que
//     chegou com a sessão fora do ar (append), histórico recente, recibos,
//     edição e apagada, anúncio CTWA, telefone real por trás do LID;
//   - eventos em lote (até 50 ou 1 s) com fila em disco que sobrevive à queda da
//     nuvem e não trava num evento recusado;
//   - nunca marca como lida (readMessages) e não fica "online" no celular;
//   - envio da fila só com o robô ligado, 1 a cada 8 s, com o id derivado do
//     servidor e filtro do próprio eco;
//   - sem auto-atualização e sem URL base editável;
//   - comprovantes: imagem e PDF que o CLIENTE manda (nunca grupo, nunca o que o mentorado manda) são baixados,
//     guardados em disco e enviados ao CRM depois que a mensagem dele já subiu (midias.mjs).
//
// A mesma classe roda no gateway (um processo filho por conexão, filho.mjs) e
// no modo PC (pc.mjs). O socket é injetável: os testes usam um socket falso.

import { EventEmitter } from 'node:events';
import { readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MapaLid, mapearMensagem, mapearRecibos, mapearRecibosGrupo, mapearGrupos, mapearChatsBase, reciboEmbutido,
  paresLid, paresLidDeContatos, waIdDaFila, toNumber, soDigitos, jidNormalizado, ehGrupo, ehLid,
  ehTelefone, telefoneParaPareamento,
} from './mapear.mjs';
import { Spool, gravarAtomico } from './spool.mjs';
import { FilaMidia, IDADE_MAX_MS, MAX_BYTES, MAX_TENTATIVAS_404, avaliarMidia, baixarMidiaBaileys } from './midias.mjs';

/*
 * A versão tem DOIS DÍGITOS em cada parte: a comparação na nuvem é textual, e
 * sem os zeros "1.9.0" pareceria maior que "1.10.0".
 */
export const VERSAO = '2.00.00';

const LOTE_MAX = 50;
const LOTE_MS = 1000;
const LOTE_MAX_BYTES = 900_000;          // a Vercel recusa corpo acima de 4,5 MB; folga grande
const INTERVALO_ENVIO_MS = 8000;         // no máximo 1 envio a cada 8 s por número
const BATIMENTO_MS = 60_000;
const FILA_ESPERA_DESCONECTADA_MS = 5 * 60_000;
const MAX_FALHAS_SERVIDOR = 20;          // um evento que dá 5xx 20 vezes sozinho vai para rejeitados
const HISTORICO_DIAS_PADRAO = 7;
const ENVIADOS_MAX = 2000;
const MIDIA_ESPERA_MAX_MS = 60_000;

const CODIGO = { loggedOut: 401, forbidden: 403, timedOut: 408, multideviceMismatch: 411, connectionReplaced: 440, restartRequired: 515 };

/** Opções que a nuvem manda para a conexão (contrato: GET /api/gateway/conexoes). */
export function normalizarOpcoes(o = {}) {
  const dias = Number(o?.historicoDias);
  return {
    gruposPermitidos: [...new Set((Array.isArray(o?.gruposPermitidos) ? o.gruposPermitidos : []).map(String).filter(ehGrupo))],
    historicoDias: o?.historicoDias != null && Number.isFinite(dias) ? Math.min(30, Math.max(0, Math.floor(dias))) : HISTORICO_DIAS_PADRAO,
    botAtivo: o?.botAtivo === true,
  };
}

/** Lê o creds.json do Baileys sem carregar o Baileys: "já pareou?" */
export async function estaPareado(pastaAuth) {
  try {
    const c = JSON.parse(await readFile(join(pastaAuth, 'creds.json'), 'utf8'));
    return !!(c?.me?.id && c?.account);
  } catch {
    return false;
  }
}

const loggerSilencioso = {
  level: 'silent',
  child() { return loggerSilencioso; },
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
};

/**
 * Socket de verdade. Só aqui o Baileys é carregado, para os testes rodarem sem ele.
 * `modulo` e `urlWs` existem para o teste de fumaça (Baileys já importado, servidor falso).
 */
export async function criarSocketBaileys({ pastaAuth, getMessage, qrTimeout, modulo, urlWs }) {
  const b = modulo || (await import('@whiskeysockets/baileys'));
  const makeWASocket = typeof b.default === 'function' ? b.default : b.makeWASocket;
  const { state, saveCreds } = await b.useMultiFileAuthState(pastaAuth);
  const config = {
    auth: state,
    logger: loggerSilencioso,
    browser: b.Browsers.macOS('Chrome'),   // fixo: o código de pareamento falha com "browser" inventado
    markOnlineOnConnect: false,            // não rouba as notificações do celular
    syncFullHistory: false,
    // Sem esta função o 6.7.24 desliga o histórico inteiro (Socket/index.js:11). FULL (anos) nunca.
    shouldSyncHistoryMessage: (n) => n?.syncType !== b.proto.Message.HistorySyncNotification.HistorySyncType.FULL,
    getMessage,
    generateHighQualityLinkPreview: false,
  };
  if (qrTimeout) config.qrTimeout = qrTimeout;
  if (urlWs) config.waWebSocketUrl = urlWs;
  if (!urlWs) {
    // Versão do WhatsApp Web; se o GitHub não responder, fica a que vem no pacote.
    try {
      const v = await b.fetchLatestBaileysVersion();
      if (Array.isArray(v?.version)) config.version = v.version;
    } catch { /* fica a padrão */ }
  }
  const sock = makeWASocket(config);
  sock.ev.on('creds.update', saveCreds);
  return { sock };
}

const esperarPadrao = (ms) => new Promise((r) => setTimeout(r, ms));

export class Sessao extends EventEmitter {
  /**
   * @param {string} conexaoId
   * @param {{gruposPermitidos?: string[], historicoDias?: number, botAtivo?: boolean}} opcoes
   * @param {{ eventos: (conexaoId: string, eventos: object[]) => Promise<any>,
   *           confirmar: (dados: object) => Promise<any> }} transporte
   * @param {{ pasta: string, criarSocket?: Function, estaPareado?: Function, agora?: () => number,
   *           esperar?: (ms: number) => Promise<void>, agendar?: Function, cancelar?: Function,
   *           log?: (texto: string, tipo?: string) => void, aleatorio?: () => number,
   *           baixarMidia?: (m: object, sock: object) => Promise<{ buffer: Buffer } | { grande: true }> }} ambiente
   */
  constructor(conexaoId, opcoes, transporte, ambiente = {}) {
    super();
    if (!ambiente.pasta) throw new Error('Sessao precisa de ambiente.pasta');
    this.conexaoId = conexaoId;
    this.opcoes = normalizarOpcoes(opcoes);
    this.transporte = transporte;
    this.pasta = ambiente.pasta;
    this.pastaAuth = join(this.pasta, 'auth');
    this._criarSocket = ambiente.criarSocket || criarSocketBaileys;
    this._estaPareado = ambiente.estaPareado || estaPareado;
    this.agora = ambiente.agora || Date.now;
    this.esperar = ambiente.esperar || esperarPadrao;
    this._agendar = ambiente.agendar || ((fn, ms) => setTimeout(fn, ms));
    this._cancelar = ambiente.cancelar || ((h) => clearTimeout(h));
    this._aleatorio = ambiente.aleatorio || Math.random;
    this._baixarMidia = ambiente.baixarMidia || baixarMidiaBaileys;
    this.log = ambiente.log || ((t, tipo = 'info') => console.log(`[${tipo}] ${t}`));

    this.estado = { conexao: 'parada', detalhe: '', numero: null, qr: null, codigo: null, recebidas: 0, enviadas: 0, naFilaLocal: 0 };
    this.sock = null;
    this.pareamento = null;
    this.lids = new MapaLid();
    this.nomesGrupos = new Map();
    this.spool = new Spool(join(this.pasta, 'pendentes.jsonl'), { rejeitados: join(this.pasta, 'rejeitados.jsonl'), log: this.log });
    this.midias = new FilaMidia(join(this.pasta, 'midias'), { log: this.log, agora: this.agora });
    this._cadeiaDownload = Promise.resolve();   // um download por vez
    this._backoffMidiaMs = 0;
    this._proximaMidia = 0;

    this._geracao = 0;            // cada socket novo invalida os handlers do anterior
    this._parando = false;
    this._desconectando = false;  // saindo do aparelho: liga só para o logout, nada é enviado
    this._pareado = false;
    this._codigoPedido = false;
    this._carregado = false;
    this._tentativasReconexao = 0;
    this._timerReconexao = null;
    this._timerBatimento = null;
    this._timerLote = null;
    this._timerRetry = null;
    this._timerLids = null;
    this._timerFila = null;
    this._drenando = null;
    this._drenarDeNovo = false;
    this._backoffMs = 0;
    this._proximaTentativa = 0;   // nuvem fora: não tenta o spool antes disso
    this._tamanhoLote = LOTE_MAX;
    this._volateis = [];
    this._recibosGrupoVistos = new Set();

    this.filaSaida = [];          // [{msg, chegouEm}]
    this._processandoFila = false;
    this._ultimoEnvio = 0;
    this.enviados = new Map();    // id da fila -> { waId, em, confirmado }
    this._ecos = new Map();       // waId -> em: o que esta sessão mandou e vai voltar como upsert
    this._cacheEnviadas = new Map(); // waId -> conteúdo, para o reenvio que o destinatário pede (getMessage)
  }

  /* ---------------- ciclo de vida ---------------- */

  /** Carrega o que ficou em disco e liga o socket. `pareamento` = {metodo:'qr'|'codigo', telefone?}. */
  async iniciar({ pareamento = null } = {}) {
    this._parando = false;
    this._desconectando = false;
    await this._carregarDisco();
    this.pareamento = pareamento ? { ...pareamento } : null;
    if (this.spool.tamanho || this.midias.tamanho) this._dispararDrenagem(0);
    await this._conectar();
  }

  async _carregarDisco() {
    if (this._carregado) return;
    this._carregado = true;
    await mkdir(this.pasta, { recursive: true, mode: 0o700 });
    await this.spool.carregar();
    await this.midias.carregar();
    this.estado.naFilaLocal = this.spool.tamanho;
    await this._carregarLids();
    await this._carregarEnviados();
  }

  /** Para sem deslogar: a sessão continua válida para religar depois. */
  async parar(detalhe = 'parada') {
    this._parando = true;
    this._limparTimers();
    this._fecharSocket();
    this._status('desconectado', { detalhe });
    await this._confirmarPendentesComoErro('sessao_parada');
    await this.descarregarAgora().catch(() => {});
    await this._gravarTudo();
  }

  /** Desconecta de vez: sai do aparelho no celular e apaga a pasta da sessão (LGPD). */
  async desconectar() {
    this._desconectando = true;
    await this._carregarDisco(); // o que ainda não subiu sobe antes de a pasta sumir
    await this._confirmarPendentesComoErro('sessao_desconectada');
    // Sessão pareada mas fora do ar: liga só para sair do aparelho, senão ele fica na lista do celular.
    if (this.estado.conexao !== 'conectado' && (await this._estaPareado(this.pastaAuth))) {
      this._parando = false;
      this.pareamento = null;
      // 'fim' aqui = o WhatsApp já deu a sessão por encerrada (401): não há de onde sair.
      let soltar;
      const pronto = new Promise((r) => { soltar = r; this.once('aberta', r); this.once('fim', r); });
      if (!this.sock) await this._conectar();
      await Promise.race([pronto, this.esperar(20_000)]);
      this.off('aberta', soltar);
      this.off('fim', soltar);
    }
    this._parando = true;
    this._limparTimers();
    const sock = this.sock;
    if (sock && this.estado.conexao === 'conectado') {
      try { await Promise.race([sock.logout(), this.esperar(15_000)]); } catch (e) { this.log(`logout: ${e.message}`, 'aviso'); }
    }
    this._fecharSocket();
    this._status('deslogado', { detalhe: 'desconectado pelo CRM' });
    await this.descarregarAgora().catch(() => {});
    await this.spool.gravado();
    if (this._timerLids) { this._cancelar(this._timerLids); this._timerLids = null; }
    await rm(this.pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    this._pareado = false;
    this._carregado = false;
    this.emit('fim', { motivo: 'desconectada' });
  }

  /** Já existe sessão salva (pareada) para esta conexão. */
  get pareado() { return this._pareado; }

  atualizarOpcoes(opcoes) {
    const antes = this.opcoes;
    this.opcoes = normalizarOpcoes(opcoes);
    // Ligou: manda o que esperava. Desligou: recusa o que esperava.
    if (antes.botAtivo !== this.opcoes.botAtivo) void this._processarFila();
  }

  /** Pedido de pareamento novo (ou troca de QR para código). Sessão já pareada ignora. */
  async parear(pareamento) {
    if (!pareamento || this._pareado) return;
    this._parando = false;
    this.pareamento = { ...pareamento };
    this._desconectando = false;
    this._codigoPedido = false;
    this._fecharSocket();
    this._tentativasReconexao = 0;
    await this._conectar();
  }

  _limparTimers() {
    for (const k of ['_timerReconexao', '_timerBatimento', '_timerLote', '_timerRetry', '_timerFila']) {
      if (this[k]) this._cancelar(this[k]);
      this[k] = null;
    }
  }

  _fecharSocket() {
    this._geracao++;
    const s = this.sock;
    this.sock = null;
    if (s) { try { s.end?.(undefined); } catch { /* já fechado */ } }
  }

  async _conectar() {
    if (this._parando) return;
    // `||`: logo depois do pair-success o creds.json pode ainda não ter terminado de gravar.
    this._pareado = this._pareado || (await this._estaPareado(this.pastaAuth));
    if (!this._pareado && !this.pareamento) {
      this._status('desconectado', { detalhe: 'sem_sessao' });
      this.emit('fim', { motivo: 'precisa_parear' });
      return;
    }
    this._status('conectando');
    const geracao = ++this._geracao;
    let sock;
    try {
      ({ sock } = await this._criarSocket({
        pastaAuth: this.pastaAuth,
        getMessage: async (key) => this._cacheEnviadas.get(key?.id),
        // No pareamento por código, o QR de 60 s em vez de 20 s dá ~6 min para digitar.
        qrTimeout: this.pareamento?.metodo === 'codigo' ? 60_000 : undefined,
      }));
    } catch (e) {
      this.log(`não consegui abrir o socket: ${e.message}`, 'erro');
      this._status('erro', { detalhe: e.message });
      this._agendarReconexao();
      return;
    }
    if (geracao !== this._geracao || this._parando) { try { sock.end?.(undefined); } catch { /* */ } return; }
    this.sock = sock;
    this._ligarHandlers(sock, geracao);
  }

  _agendarReconexao(imediata = false) {
    if (this._parando) return;
    const n = this._tentativasReconexao++;
    // "Imediata" ainda espera 1 s: o creds.json do pareamento precisa estar no disco.
    const base = imediata ? 1000 : Math.min(300_000, 2000 * 2 ** n);
    const ms = base + Math.floor(this._aleatorio() * Math.min(5000, base / 2));
    if (this._timerReconexao) this._cancelar(this._timerReconexao);
    this._timerReconexao = this._agendar(() => { this._timerReconexao = null; void this._conectar(); }, ms);
  }

  /* ---------------- handlers do Baileys ---------------- */

  _ligarHandlers(sock, geracao) {
    const vivo = () => geracao === this._geracao && !this._parando;
    const on = (evento, fn) => sock.ev.on(evento, (dados) => {
      if (!vivo()) return;
      try {
        const r = fn(dados);
        if (r?.catch) r.catch((e) => this.log(`${evento}: ${e.message}`, 'erro'));
      } catch (e) {
        this.log(`${evento}: ${e.message}`, 'erro');
      }
    });

    on('connection.update', (u) => this._aoAtualizarConexao(u || {}, sock));
    on('messages.upsert', ({ messages, type }) => {
      for (const m of messages || []) this._aoReceber(m, type === 'notify' ? 'notify' : 'append');
    });
    on('messaging-history.set', (h) => this._aoReceberHistorico(h || {}));
    on('messages.update', (lista) => this._emitirVarios(mapearRecibos(lista, this._ctx())));
    on('message-receipt.update', (lista) => {
      const novos = mapearRecibosGrupo(lista, this._ctx()).filter((r) => {
        const chave = `${r.waId}:${r.status}`;
        if (this._recibosGrupoVistos.has(chave)) return false;
        this._recibosGrupoVistos.add(chave);
        if (this._recibosGrupoVistos.size > 5000) this._recibosGrupoVistos.delete(this._recibosGrupoVistos.values().next().value);
        return true;
      });
      this._emitirVarios(novos);
    });
    on('contacts.upsert', (lista) => this._aprenderLids(paresLidDeContatos(lista)));
    on('contacts.update', (lista) => this._aprenderLids(paresLidDeContatos(lista)));
    on('chats.phoneNumberShare', ({ lid, jid }) => this._aprenderLids([[lid, jid]]));
    on('groups.update', (lista) => {
      for (const g of lista || []) if (g?.id && g.subject) this.nomesGrupos.set(g.id, String(g.subject));
    });
    on('groups.upsert', (lista) => {
      for (const g of lista || []) if (g?.id && g.subject) this.nomesGrupos.set(g.id, String(g.subject));
      void this._enviarGrupos(sock, geracao);
    });
  }

  async _aoAtualizarConexao({ connection, lastDisconnect, qr, isNewLogin }, sock) {
    if (isNewLogin) {
      // pair-success: o próximo close é o 515 de praxe, e a reconexão já entra pareada.
      this._pareado = true;
      this.pareamento = null;
    }

    if (qr) {
      if (!this.pareamento) {
        // Só pede QR quem não tem sessão; sem pedido de pareamento não há quem leia.
        this._status('desconectado', { detalhe: 'sem_sessao' });
        this._parando = true;
        this._fecharSocket();
        this.emit('fim', { motivo: 'precisa_parear' });
        return;
      }
      if (this.pareamento.metodo === 'codigo') {
        if (!this._codigoPedido) {
          this._codigoPedido = true;
          const telefone = telefoneParaPareamento(this.pareamento.telefone);
          let codigo;
          try {
            if (!/^\d{10,15}$/.test(telefone)) throw new Error('telefone_invalido_para_codigo');
            codigo = await sock.requestPairingCode(telefone);
          } catch (e) {
            this._status('erro', { detalhe: `codigo_de_pareamento: ${e.message}` });
            this._parando = true;
            this._fecharSocket();
            this.emit('fim', { motivo: 'precisa_parear' });
            return;
          }
          this.estado.codigo = codigo;
          this.emit('codigo', codigo);
          this._emitirVolatil({ tipo: 'codigo_pareamento', codigo });
          this._status('aguardando_codigo');
        }
      } else {
        this.estado.qr = qr;
        this.emit('qr', qr);
        this._emitirVolatil({ tipo: 'qr', qr });
        if (this.estado.conexao !== 'aguardando_qr') this._status('aguardando_qr');
        this.estado.qr = qr;
      }
    }

    if (connection === 'open') {
      this._pareado = true;
      this.pareamento = null;
      this._codigoPedido = false;
      this._tentativasReconexao = 0;
      this.estado.codigo = null;
      const numero = soDigitos(String(sock.user?.id || '').split(':')[0].split('@')[0]) || null;
      this._status('conectado', { numero });
      void this._enviarGrupos(sock, this._geracao);
      this._iniciarBatimento();
      void this._processarFila();
      this.emit('aberta');
    }

    if (connection === 'close') {
      if (this._timerBatimento) { this._cancelar(this._timerBatimento); this._timerBatimento = null; }
      const codigo = lastDisconnect?.error?.output?.statusCode;
      this.sock = null;
      this._geracao++;
      if (codigo === CODIGO.loggedOut) {
        this._status('deslogado', { detalhe: 'saiu do aparelho conectado no celular' });
        this._parando = true;
        this._pareado = false;
        await this._confirmarPendentesComoErro('sessao_deslogada');
        await rm(this.pastaAuth, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        await this.descarregarAgora().catch(() => {});
        this.emit('fim', { motivo: 'deslogado' });
        return;
      }
      if (codigo === CODIGO.forbidden || codigo === CODIGO.connectionReplaced || codigo === CODIGO.multideviceMismatch) {
        const detalhe = codigo === CODIGO.forbidden ? 'o WhatsApp recusou esta sessão (403): o número pode ter sido bloqueado'
          : codigo === CODIGO.connectionReplaced ? 'outra cópia desta sessão conectou (440): esta parou para não brigar'
            : `sessão incompatível (${codigo})`;
        this._status('erro', { detalhe });
        this._parando = true;
        await this._confirmarPendentesComoErro('sessao_com_erro');
        await this.descarregarAgora().catch(() => {});
        this.emit('fim', { motivo: 'fatal', codigo });
        return;
      }
      if (codigo === CODIGO.restartRequired) {  // normal logo depois de parear
        this._agendarReconexao(true);
        return;
      }
      if (!this._pareado) {
        // Pareamento não se religa sozinho: sem alguém olhando a tela, QR novo é QR para ninguém.
        this._status('desconectado', { detalhe: codigo === CODIGO.timedOut ? 'pareamento_expirou' : `pareamento_interrompido (código ${codigo ?? '?'})` });
        this._parando = true;
        await this.descarregarAgora().catch(() => {});
        this.emit('fim', { motivo: 'precisa_parear' });
        return;
      }
      this._status('desconectado', { detalhe: `queda de conexão (código ${codigo ?? '?'})` });
      this._agendarReconexao();
    }
  }

  _ctx() {
    const eu = this.sock?.user || {};
    return {
      agora: this.agora(),
      gruposPermitidos: new Set(this.opcoes.gruposPermitidos),
      nomesGrupos: this.nomesGrupos,
      lids: this.lids,
      meusJids: [eu.id, eu.lid].filter(Boolean),
    };
  }

  _aoReceber(m, origem) {
    const k = m?.key || {};
    // Eco do que esta sessão mandou pela fila: já está no CRM como bot/crm.
    if (k.fromMe && k.id && this._ecos.has(k.id)) return;
    this._aprenderLids(paresLid(m));
    const ctx = this._ctx();
    const ev = mapearMensagem(m, origem, ctx);
    if (!ev) return;
    if (ev.tipo === 'mensagem') this.estado.recebidas++;
    const recibo = reciboEmbutido(m, ev, ctx);
    this._emitirVarios(recibo ? [ev, recibo] : [ev]);
    this._talvezBaixarMidia(m, ev);
  }

  /* ---------------- comprovantes ---------------- */

  /** Imagem ou PDF de um cliente em conversa individual: baixa (um por vez) e guarda para subir ao CRM. */
  _talvezBaixarMidia(m, ev) {
    const av = avaliarMidia(ev);
    if (!av.baixar) {
      if (av.motivo === 'grande') this.log(`comprovante de ${Math.round(ev.midia.tamanho / 1024)} KB passa do limite de ${MAX_BYTES / 1024 / 1024} MB: fica só o registro da mensagem`, 'info');
      return;
    }
    // O CRM que não aceita arquivo (transporte antigo) não recebe download à toa.
    if (typeof this.transporte.midia !== 'function') return;
    const sock = this.sock;
    this._cadeiaDownload = this._cadeiaDownload
      .then(() => this._baixarEGuardar(m, ev, av.mimetype, sock))
      .catch((e) => this.log(`comprovante ${ev.waId}: ${e.message}`, 'aviso'));
  }

  async _baixarEGuardar(m, ev, mimetype, sock) {
    if (this._parando || this._desconectando || !sock) return;
    let r;
    try {
      r = await this._baixarMidia(m, sock);
    } catch (e) {
      this.log(`não consegui baixar o comprovante ${ev.waId}: ${e.message}`, 'aviso');
      return;
    }
    if (r?.grande || !r?.buffer?.length) {
      if (r?.grande) this.log(`comprovante ${ev.waId} passou de ${MAX_BYTES / 1024 / 1024} MB: fica só o registro da mensagem`, 'info');
      return;
    }
    // Saiu do ar ou foi desconectada durante o download: nada novo vai para o disco (a pasta pode já ter sido apagada).
    if (this._parando || this._desconectando) return;
    if (r.buffer.length > MAX_BYTES) {
      this.log(`comprovante ${ev.waId} passou de ${MAX_BYTES / 1024 / 1024} MB: fica só o registro da mensagem`, 'info');
      return;
    }
    if (await this.midias.guardar({ waId: ev.waId, chatJid: ev.chatJid, mimetype, buffer: r.buffer })) this._dispararDrenagem(0);
  }

  /**
   * Sobe os comprovantes guardados. Só depois que as mensagens subiram (o CRM precisa conhecer o waId).
   * 404 = o CRM ainda não conhece a mensagem (tenta de novo, no máximo 5 vezes e 24 h); 400/403/413/415/422 =
   * recusa definitiva (grupo, conversa privada, tipo errado): o arquivo é apagado; o resto espera e tenta de novo.
   */
  async _drenarMidias() {
    if (!this.midias.tamanho || typeof this.transporte.midia !== 'function') return;
    if (this.spool.tamanho || this._proximaMidia > this.agora()) return;
    let esperar404 = false;
    for (const meta of this.midias.listar()) {
      if (this.agora() - meta.em > IDADE_MAX_MS) {
        this.log(`comprovante ${meta.waId} passou de 24 h sem o CRM aceitar e foi descartado`, 'aviso');
        await this.midias.remover(meta.id);
        continue;
      }
      let corpo;
      try { corpo = await this.midias.ler(meta.id); } catch { await this.midias.remover(meta.id); continue; }
      try {
        await this.transporte.midia({ conexaoId: this.conexaoId, waId: meta.waId, chatJid: meta.chatJid, mimetype: meta.mimetype, corpo });
        await this.midias.remover(meta.id);
        this._backoffMidiaMs = 0;
      } catch (e) {
        const s = e?.httpStatus;
        if (s === 404) {
          if ((await this.midias.contar404(meta.id)) >= MAX_TENTATIVAS_404) {
            this.log(`o CRM nunca achou a mensagem do comprovante ${meta.waId}; descartado`, 'aviso');
            await this.midias.remover(meta.id);
          } else esperar404 = true;
          continue;
        }
        if ([400, 403, 413, 415, 422].includes(s)) {
          this.log(`o CRM recusou o comprovante ${meta.waId} (${e.message}); descartado`, 'info');
          await this.midias.remover(meta.id);
          continue;
        }
        // Rede, 401 (segredo ou relógio), 429, 5xx (o 403 já saiu acima: é definitivo): espera e tenta de novo, sem descartar nada.
        this._backoffMidiaMs = Math.min(MIDIA_ESPERA_MAX_MS, this._backoffMidiaMs ? this._backoffMidiaMs * 2 : 1000);
        this._proximaMidia = this.agora() + this._backoffMidiaMs;
        this.log(`comprovante ${meta.waId} não subiu (${e.message}); ${this.midias.tamanho} guardado(s), nova tentativa em ${Math.round(this._backoffMidiaMs / 1000)} s`, 'aviso');
        this._dispararDrenagem(this._backoffMidiaMs);
        return;
      }
    }
    if (esperar404) this._dispararDrenagem(30_000);
  }

  _aoReceberHistorico({ chats, contacts, messages }) {
    this._aprenderLids(paresLidDeContatos(contacts, chats));
    for (const c of chats || []) if (ehGrupo(c?.id) && c.name) this.nomesGrupos.set(c.id, String(c.name));
    const ctx = this._ctx();
    this._emitirVarios(mapearChatsBase(chats, ctx));
    const dias = this.opcoes.historicoDias;
    if (!dias) return;
    const corte = ctx.agora / 1000 - dias * 86400;
    let n = 0;
    for (const m of messages || []) {
      if (toNumber(m?.messageTimestamp) < corte) continue;
      if (m?.key?.fromMe && this._ecos.has(m.key.id)) continue;
      this._aprenderLids(paresLid(m));
      const ev = mapearMensagem(m, 'historico', ctx);
      if (ev) { this._emitir(ev); n++; }
    }
    if (n) this.log(`histórico: ${n} mensagem(ns) dos últimos ${dias} dia(s)`, 'info');
  }

  async _enviarGrupos(sock, geracao) {
    try {
      const grupos = await sock.groupFetchAllParticipating();
      if (geracao !== this._geracao) return;
      for (const g of Object.values(grupos || {})) if (g?.id && g.subject) this.nomesGrupos.set(g.id, String(g.subject));
      this._emitir(mapearGrupos(grupos));
    } catch (e) {
      this.log(`não consegui listar os grupos: ${e.message}`, 'aviso');
    }
  }

  _iniciarBatimento() {
    if (this._timerBatimento) this._cancelar(this._timerBatimento);
    const bater = () => {
      this._timerBatimento = this._agendar(bater, BATIMENTO_MS);
      if (this.estado.conexao === 'conectado') this._emitirVolatil({ tipo: 'batimento', versao: VERSAO });
    };
    this._timerBatimento = this._agendar(bater, BATIMENTO_MS);
  }

  /* ---------------- LID ---------------- */

  _aprenderLids(pares) {
    let mudou = false;
    for (const [lid, pn] of pares || []) if (this.lids.aprender(lid, pn)) mudou = true;
    if (mudou && !this._timerLids) {
      this._timerLids = this._agendar(() => { this._timerLids = null; void this._gravarLids(); }, 2000);
    }
  }

  async _carregarLids() {
    try { this.lids = new MapaLid(JSON.parse(await readFile(join(this.pasta, 'lids.json'), 'utf8'))); } catch { /* vazio */ }
  }

  async _gravarLids() {
    try { await gravarAtomico(join(this.pasta, 'lids.json'), JSON.stringify(this.lids.paraObjeto())); } catch (e) {
      this.log(`não consegui gravar lids.json: ${e.message}`, 'aviso');
    }
  }

  /* ---------------- estado ---------------- */

  _status(status, extra = {}) {
    this.estado.conexao = status;
    this.estado.detalhe = extra.detalhe || '';
    if (extra.numero !== undefined) this.estado.numero = extra.numero;
    if (status !== 'aguardando_qr') this.estado.qr = null;
    const ev = { tipo: 'status', status };
    if (extra.numero) ev.numero = extra.numero;
    if (extra.detalhe) ev.detalhe = String(extra.detalhe).slice(0, 300);
    this.emit('estado', { ...this.estado });
    this.log(`whatsapp: ${status}${extra.detalhe ? ` (${extra.detalhe})` : ''}`, status === 'conectado' ? 'ok' : status === 'erro' ? 'erro' : 'info');
    this._emitir(ev);
  }

  /* ---------------- eventos para a nuvem ---------------- */

  _emitir(ev) { this._emitirVarios([ev]); }

  _emitirVarios(eventos) {
    if (!eventos?.length) return;
    void this.spool.adicionar(eventos);
    this.estado.naFilaLocal = this.spool.tamanho;
    if (this._proximaTentativa > this.agora()) return;   // nuvem fora: o retry agendado drena
    if (this.spool.tamanho >= LOTE_MAX) this._dispararDrenagem(0);
    else if (!this._timerLote) this._timerLote = this._agendar(() => { this._timerLote = null; this._dispararDrenagem(0); }, LOTE_MS);
  }

  /** QR, código e batimento: valem agora ou nunca; não vão para o disco. */
  _emitirVolatil(ev) {
    this._volateis.push(ev);
    if (this._volateis.length > 20) this._volateis.splice(0, this._volateis.length - 20);
    this._dispararDrenagem(0);
  }

  _dispararDrenagem(ms) {
    if (ms <= 0) { void this._drenar(); return; }
    if (this._timerRetry) return;
    this._timerRetry = this._agendar(() => {
      this._timerRetry = null;
      this._proximaTentativa = 0;
      this._proximaMidia = 0;
      void this._drenar();
    }, ms);
  }

  /** Sobe tudo o que der agora e espera terminar (usado no desligamento e nos testes). */
  async descarregarAgora() {
    if (this._timerLote) { this._cancelar(this._timerLote); this._timerLote = null; }
    if (this._timerRetry) { this._cancelar(this._timerRetry); this._timerRetry = null; }
    this._proximaTentativa = 0;
    this._proximaMidia = 0;
    await this._drenar();
  }

  /** Espera os downloads de comprovante em andamento (os testes usam; o desligamento não espera). */
  aguardarDownloads() { return this._cadeiaDownload; }

  _drenar() {
    if (this._drenando) { this._drenarDeNovo = true; return this._drenando; }
    this._drenando = (async () => {
      try {
        do {
          this._drenarDeNovo = false;
          await this._drenarVolateis();
          await this._drenarSpool();
          await this._drenarMidias();
        } while (this._drenarDeNovo && this._proximaTentativa <= this.agora());
      } finally {
        this._drenando = null;
        this.estado.naFilaLocal = this.spool.tamanho;
      }
    })();
    return this._drenando;
  }

  async _drenarVolateis() {
    if (!this._volateis.length) return;
    const eventos = this._volateis.splice(0);
    try {
      await this.transporte.eventos(this.conexaoId, eventos);
    } catch (e) {
      this.log(`não subiu ${eventos.length} aviso(s) momentâneo(s): ${e.message}`, 'aviso');
    }
  }

  async _drenarSpool() {
    // QR e batimento chegam a qualquer hora; não são motivo para furar a espera.
    if (this._proximaTentativa > this.agora()) return;
    while (this.spool.tamanho) {
      const lote = this.spool.primeiros(this._tamanhoLote, LOTE_MAX_BYTES);
      let resp;
      try {
        resp = await this.transporte.eventos(this.conexaoId, lote.map((i) => i.ev));
      } catch (e) {
        const s = e?.httpStatus;
        if ((s === 400 || s === 413 || s === 422) && lote.length > 1) {
          // Lote recusado inteiro: divide até isolar o evento ruim, sem perder os bons.
          this._tamanhoLote = Math.max(1, Math.ceil(lote.length / 2));
          continue;
        }
        if (s === 400 || s === 413 || s === 422) {
          await this.spool.rejeitar(lote[0].ev, e.message);
          await this.spool.remover(1);
          this.log(`evento recusado pelo CRM e descartado: ${e.message}`, 'erro');
          continue;
        }
        if (s >= 500) {
          const falhas = this.spool.marcarFalha();
          if (lote.length > 1 && falhas >= 3) this._tamanhoLote = Math.max(1, Math.ceil(lote.length / 2));
          if (lote.length === 1 && falhas >= MAX_FALHAS_SERVIDOR) {
            await this.spool.rejeitar(lote[0].ev, e.message);
            await this.spool.remover(1);
            this.log(`evento deu erro no CRM ${falhas} vezes e foi para rejeitados.jsonl`, 'erro');
            continue;
          }
        }
        // Rede, 401/403 (segredo, relógio), 404 (rota ainda não publicada), 429, 5xx: espera e tenta de novo.
        this._backoffMs = Math.min(60_000, this._backoffMs ? this._backoffMs * 2 : 1000);
        this._proximaTentativa = this.agora() + this._backoffMs;
        this.log(`CRM fora do ar ou recusando (${e.message}); ${this.spool.tamanho} evento(s) guardado(s), nova tentativa em ${Math.round(this._backoffMs / 1000)} s`, 'aviso');
        this._dispararDrenagem(this._backoffMs);
        return;
      }
      // 200: o envelope foi aceito. Erro por índice é recusa daquele evento só.
      const erros = Array.isArray(resp?.erros) ? resp.erros : [];
      for (const er of erros) {
        const item = lote[Number(er?.indice)];
        if (item) await this.spool.rejeitar(item.ev, er?.erro ?? 'erro');
      }
      if (erros.length) this.log(`CRM recusou ${erros.length} de ${lote.length} evento(s)`, 'aviso');
      await this.spool.remover(lote.length);
      this._backoffMs = 0;
      this._proximaTentativa = 0;
      this._tamanhoLote = Math.min(LOTE_MAX, this._tamanhoLote * 2);
    }
  }

  /* ---------------- fila de saída ---------------- */

  /** Mensagens que o CRM reservou para esta conexão: [{id, conexaoId?, para, corpo, tipo}]. */
  enfileirarEnvio(mensagens) {
    for (const msg of mensagens || []) {
      if (!msg?.id || this.filaSaida.some((f) => f.msg.id === msg.id)) continue;
      if (this._parando || this._desconectando) {
        // Sessão parando, parada ou saindo do aparelho: a reserva volta agora, senão fica presa no CRM.
        const ja = this.enviados.get(String(msg.id));
        void this._confirmar(ja ? { id: msg.id, status: 'enviada', waId: ja.waId } : { id: msg.id, status: 'erro', erro: 'sessao_parada' });
        continue;
      }
      this.filaSaida.push({ msg, chegouEm: this.agora() });
    }
    return this._processarFila();
  }

  async _processarFila() {
    if (this._processandoFila) return;
    this._processandoFila = true;
    try {
      while (this.filaSaida.length && !this._parando && !this._desconectando) {
        const { msg, chegouEm } = this.filaSaida[0];
        const ja = this.enviados.get(String(msg.id));
        if (ja) {
          // O CRM devolveu uma mensagem que já saiu (a confirmação se perdeu): só confirma de novo.
          this.filaSaida.shift();
          await this._confirmar({ id: msg.id, status: 'enviada', waId: ja.waId });
          continue;
        }
        if (!this.opcoes.botAtivo) {
          this.filaSaida.shift();
          await this._confirmar({ id: msg.id, status: 'erro', erro: 'envio_desligado: o robô desta conexão está desligado' });
          continue;
        }
        if (this.estado.conexao !== 'conectado' || !this.sock) {
          if (this.agora() - chegouEm > FILA_ESPERA_DESCONECTADA_MS) {
            this.filaSaida.shift();
            await this._confirmar({ id: msg.id, status: 'erro', erro: 'whatsapp_desconectado' });
            continue;
          }
          if (!this._timerFila) this._timerFila = this._agendar(() => { this._timerFila = null; void this._processarFila(); }, 60_000);
          return; // volta no 'open' ou no timer
        }
        this.filaSaida.shift();
        await this._enviarUma(msg);
      }
    } finally {
      this._processandoFila = false;
    }
  }

  async _enviarUma(msg) {
    const erro = (motivo) => this._confirmar({ id: msg.id, status: 'erro', erro: motivo });
    const para = String(msg.para || '');
    const corpo = typeof msg.corpo === 'string' ? msg.corpo : '';
    if ((msg.tipo ?? 'texto') !== 'texto') return erro('tipo_nao_suportado');
    if (!corpo.trim()) return erro('corpo_vazio');
    let jid = para.includes('@') ? jidNormalizado(para) : null;
    if (jid && !(ehTelefone(jid) || ehLid(jid))) return erro('destino_invalido: só conversa individual');
    try {
      if (!jid) jid = await this._jidDeVerdade(para);
      // Espaçamento entre envios do mesmo número.
      const falta = this._ultimoEnvio + INTERVALO_ENVIO_MS - this.agora();
      if (falta > 0) await this.esperar(falta);
      await this._digitando(jid, corpo);
      const sock = this.sock;
      if (!sock || this.estado.conexao !== 'conectado') throw new Error('whatsapp_desconectado');
      const waId = waIdDaFila(msg.id);
      this._ecos.set(waId, this.agora());
      podar(this._ecos, ENVIADOS_MAX);
      const r = await sock.sendMessage(jid, { text: corpo }, { messageId: waId });
      this._ultimoEnvio = this.agora();
      if (r?.message) { this._cacheEnviadas.set(waId, r.message); podar(this._cacheEnviadas, 300); }
      this.enviados.set(String(msg.id), { waId, em: new Date(this.agora()).toISOString(), confirmado: false });
      podar(this.enviados, ENVIADOS_MAX);
      void this._gravarEnviados();
      this.estado.enviadas++;
      await this._confirmar({ id: msg.id, status: 'enviada', waId });
    } catch (e) {
      this._ultimoEnvio = this.agora();
      await erro(String(e?.message || e).slice(0, 300));
    }
  }

  /** "digitando..." pelo tempo que uma pessoa levaria: mensagem pronta no mesmo segundo é cara de robô. */
  async _digitando(jid, texto) {
    const tempo = Math.min(6000, Math.max(1200, String(texto || '').length * 45));
    try {
      await this.sock?.sendPresenceUpdate('composing', jid);
      await this.esperar(tempo);
      await this.sock?.sendPresenceUpdate('paused', jid);
    } catch { /* presença é cortesia; a mensagem vai mesmo assim */ }
  }

  /** Telefone sem jid: pergunta ao WhatsApp (resolve o 55 e o nono dígito). */
  async _jidDeVerdade(telefone) {
    const so = soDigitos(telefone);
    if (!so) throw new Error('destino_vazio');
    const formatos = so.startsWith('55') ? [so, so.slice(2)] : [`55${so}`, so];
    for (const numero of formatos) {
      try {
        const [achado] = await this.sock.onWhatsApp(numero);
        if (achado?.exists && achado.jid) return jidNormalizado(achado.jid);
      } catch { /* tenta o próximo formato */ }
    }
    throw new Error('numero_sem_whatsapp');
  }

  async _confirmar(dados, tentativa = 0) {
    try {
      await this.transporte.confirmar(dados);
      const e = this.enviados.get(String(dados.id));
      if (e && dados.status === 'enviada' && !e.confirmado) { e.confirmado = true; void this._gravarEnviados(); }
    } catch (e) {
      const recusa = e?.httpStatus >= 400 && e?.httpStatus < 500 && ![401, 403, 408, 429].includes(e.httpStatus);
      if (tentativa >= 4 || recusa) {
        this.log(`não consegui confirmar a mensagem ${dados.id} no CRM: ${e.message}`, 'aviso');
        return;
      }
      this._agendar(() => void this._confirmar(dados, tentativa + 1), 1000 * 2 ** tentativa);
    }
  }

  async _confirmarPendentesComoErro(motivo) {
    const pendentes = this.filaSaida.splice(0);
    for (const { msg } of pendentes) await this._confirmar({ id: msg.id, status: 'erro', erro: motivo });
  }

  async _carregarEnviados() {
    try {
      const obj = JSON.parse(await readFile(join(this.pasta, 'enviados.json'), 'utf8'));
      for (const [id, v] of Object.entries(obj || {})) {
        if (v?.waId) { this.enviados.set(id, v); this._ecos.set(v.waId, Date.parse(v.em) || 0); }
      }
    } catch { /* vazio */ }
  }

  async _gravarEnviados() {
    try { await gravarAtomico(join(this.pasta, 'enviados.json'), JSON.stringify(Object.fromEntries(this.enviados))); } catch (e) {
      this.log(`não consegui gravar enviados.json: ${e.message}`, 'aviso');
    }
  }

  async _gravarTudo() {
    if (this._timerLids) { this._cancelar(this._timerLids); this._timerLids = null; }
    await Promise.all([this.spool.gravado(), this._gravarLids(), this._gravarEnviados()]);
  }
}

function podar(mapa, max) {
  while (mapa.size > max) mapa.delete(mapa.keys().next().value);
}
