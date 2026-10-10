// supervisor.mjs — decide quais sessões rodam no gateway, a partir do CRM.
//
// Um processo filho por conexão (filho.mjs): uma sessão que trava ou estoura a
// memória não derruba as outras, e cada uma tem o seu limite de heap.
// O processo é criado por `fork`, injetável para os testes.

import { readFile, readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { gravarAtomico } from './spool.mjs';
import { estaPareado } from './sessao.mjs';

export const ID_VALIDO = /^[A-Za-z0-9-]{1,64}$/;
/** Código de saída do filho -> por que parou. */
export const SAIDA = { parada: 0, precisa_parear: 10, deslogado: 11, fatal: 12, desconectada: 13 };
const MOTIVO_DA_SAIDA = Object.fromEntries(Object.entries(SAIDA).map(([k, v]) => [v, k]));

const SINCRONIZAR_MS = 60_000;
const FILA_RESERVA_MS = 30_000;
const PAREAMENTO_VALIDO_MS = 10 * 60_000;    // pedido mais velho que isso é resto, não pedido
const DESCONEXAO_VALIDA_MS = 10 * 60_000;
const RETER_PARADA_DIAS = 7;                 // sessão parada e fora da lista por 7 dias: sai do aparelho e apaga
const LIMITE_FILA = 50;

export class Supervisor {
  /**
   * @param {{ transporte: { conexoes: Function, fila: Function, confirmar: Function },
   *           dados: string, fork: (conexaoId: string) => import('node:child_process').ChildProcess,
   *           log?: Function, agora?: () => number, esperar?: (ms: number) => Promise<void>,
   *           aleatorio?: () => number, estaPareado?: (pastaAuth: string) => Promise<boolean> }} op
   */
  constructor(op) {
    this.transporte = op.transporte;
    this.pastaSessoes = join(op.dados, 'sessoes');
    this._fork = op.fork;
    this.log = op.log || ((t) => console.log(t));
    this.agora = op.agora || Date.now;
    this.esperar = op.esperar || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.aleatorio = op.aleatorio || Math.random;
    this._estaPareado = op.estaPareado || estaPareado;
    /** @type {Map<string, any>} */
    this.sessoes = new Map();
    this._filaInicio = [];
    this._iniciando = false;
    this._ultimoInicio = 0;
    this._sincronizando = null;
    this._sincronizarDeNovo = false;
    this._buscandoFila = false;
    this._buscarDeNovo = false;
    this._desconexaoPedida = new Map(); // conexaoId -> quando a campainha pediu
    this._timers = [];
    this._encerrando = false;
  }

  async iniciar() {
    await this.sincronizar();
    this._timers.push(setInterval(() => void this.sincronizar(), SINCRONIZAR_MS));
    this._timers.push(setInterval(() => void this.buscarFila(), FILA_RESERVA_MS));
  }

  /** Campainha do CRM (já com a assinatura conferida). */
  async aoAcordar({ conexaoId, motivo }) {
    if (motivo === 'fila') return this.buscarFila();
    if (motivo === 'desconectar' && conexaoId && ID_VALIDO.test(conexaoId)) this._desconexaoPedida.set(conexaoId, this.agora());
    return this.sincronizar();
  }

  _sessao(id) {
    let s = this.sessoes.get(id);
    if (!s) {
      s = {
        id, filho: null, ordem: null, deveRodar: false, desconectar: false, opcoes: {}, opcoesJson: '{}', ultimoPareamentoEm: null,
        bloqueado: null, falhas: 0, proximoInicio: 0, inicioEm: 0, naFilaDeInicio: false, conexao: null,
      };
      this.sessoes.set(id, s);
    }
    return s;
  }

  /* ---------------- sincronizar com o CRM ---------------- */

  sincronizar() {
    if (this._sincronizando) { this._sincronizarDeNovo = true; return this._sincronizando; }
    this._sincronizando = (async () => {
      try {
        do {
          this._sincronizarDeNovo = false;
          await this._sincronizarUmaVez();
        } while (this._sincronizarDeNovo && !this._encerrando);
      } finally {
        this._sincronizando = null;
      }
    })();
    return this._sincronizando;
  }

  async _sincronizarUmaVez() {
    if (this._encerrando) return;
    let resp;
    try {
      resp = await this.transporte.conexoes();
    } catch (e) {
      // CRM fora: ninguém é parado nem iniciado por falta de resposta.
      this.log(`não consegui ler as conexões no CRM: ${e.message}`, 'aviso');
      return;
    }
    const lista = (Array.isArray(resp?.conexoes) ? resp.conexoes : []).filter((c) => ID_VALIDO.test(String(c?.id || '')));
    const agora = this.agora();
    for (const [id, em] of this._desconexaoPedida) if (agora - em > DESCONEXAO_VALIDA_MS) this._desconexaoPedida.delete(id);

    const naLista = new Set();
    for (const c of lista) {
      naLista.add(c.id);
      await this._aplicar(c, agora);
    }
    // Rodando mas fora da lista (conexão apagada): para, sem deslogar.
    for (const s of this.sessoes.values()) {
      if (naLista.has(s.id)) continue;
      s.deveRodar = false;
      s.desconectar = false;
      if (s.filho && !s.ordem) {
        s.ordem = 'parar';
        this._mandar(s, { tipo: 'parar' });
      }
    }
    await this._limparPastasParadas(naLista, lista, agora);
  }

  async _aplicar(c, agora) {
    const s = this._sessao(c.id);
    s.deveRodar = c.deveRodar === true;
    const opcoesJson = JSON.stringify(c.opcoes || {});
    const mudouOpcoes = opcoesJson !== s.opcoesJson;
    s.opcoes = c.opcoes || {};
    s.opcoesJson = opcoesJson;

    const p = c.pareamento;
    const solicitadoMs = Date.parse(p?.solicitadoEm || '');
    const pedidoNovo = !!p && ['qr', 'codigo'].includes(p.metodo) && Number.isFinite(solicitadoMs) &&
      agora - solicitadoMs < PAREAMENTO_VALIDO_MS && p.solicitadoEm !== s.ultimoPareamentoEm;

    if (!s.deveRodar) {
      // O pedido de desconexão só sai daqui quando o filho termina como 'desconectada':
      // um "parar" que já estava em curso não engole o pedido.
      const desconectar = c.desconectar === true || this._desconexaoPedida.has(c.id);
      s.desconectar = desconectar;
      if (s.filho) {
        const ordem = desconectar ? 'desconectar' : 'parar';
        if (s.ordem !== ordem && s.ordem !== 'desconectar') {
          s.ordem = ordem;
          this._mandar(s, { tipo: ordem, opcoes: s.opcoes });
        }
      } else if (desconectar && agora >= s.proximoInicio && (await this._existePasta(c.id))) {
        this._iniciarFilho(s, { comando: 'desconectar' });
      }
      return;
    }
    s.desconectar = false;

    if (s.filho) {
      // Processo saindo (já recebeu "parar"): pedido e opções ficam para o que vai subir no lugar dele.
      if (s.ordem) return;
      if (mudouOpcoes) this._mandar(s, { tipo: 'opcoes', opcoes: s.opcoes });
      if (pedidoNovo) {
        s.ultimoPareamentoEm = p.solicitadoEm;
        this._mandar(s, { tipo: 'parear', pareamento: { metodo: p.metodo, telefone: p.telefone ?? null } });
      }
      return;
    }

    if (pedidoNovo) {
      s.ultimoPareamentoEm = p.solicitadoEm;
      s.bloqueado = null;
      s.proximoInicio = 0;
      this._enfileirarInicio(s, { metodo: p.metodo, telefone: p.telefone ?? null }, true);
      return;
    }
    if (s.bloqueado) return;                       // espera um pedido de pareamento novo
    if (agora < s.proximoInicio || s.naFilaDeInicio) return;
    if (!(await this._estaPareado(join(this.pastaSessoes, c.id, 'auth')))) {
      s.bloqueado = { motivo: 'sem_sessao', em: agora };
      return;
    }
    this._enfileirarInicio(s, null, false);
  }

  /* ---------------- início espaçado (R1) ---------------- */

  _enfileirarInicio(s, pareamento, prioridade) {
    s.naFilaDeInicio = true;
    // Já na fila (ex.: religando quando chegou o pedido de pareamento): atualiza em vez de duplicar.
    const i = this._filaInicio.findIndex((x) => x.id === s.id);
    const item = i >= 0 ? this._filaInicio.splice(i, 1)[0] : { id: s.id, pareamento: null };
    if (pareamento) item.pareamento = pareamento;
    // Pareamento tem gente olhando para a tela: passa na frente.
    if (prioridade) this._filaInicio.unshift(item); else this._filaInicio.push(item);
    this._inicios = this._processarInicios();
  }

  /** Espera a sincronização e a fila de inícios em andamento terminarem. */
  async ocioso() {
    while (this._sincronizando || this._iniciando) {
      await this._sincronizando;
      await this._inicios;
    }
  }

  /** Religa as sessões uma a uma, com 5 a 15 s aleatórios entre elas: 25 aparelhos voltando no mesmo segundo é assinatura de robô. */
  async _processarInicios() {
    if (this._iniciando) return;
    this._iniciando = true;
    try {
      while (this._filaInicio.length && !this._encerrando) {
        const espera = this._ultimoInicio ? this._ultimoInicio + 5000 + Math.floor(this.aleatorio() * 10_000) - this.agora() : 0;
        if (espera > 0) await this.esperar(espera);
        const { id, pareamento } = this._filaInicio.shift();
        const s = this.sessoes.get(id);
        if (!s) continue;
        s.naFilaDeInicio = false;
        if (!s.deveRodar || s.filho || this._encerrando) continue;
        this._iniciarFilho(s, { comando: 'iniciar', pareamento });
        this._ultimoInicio = this.agora();
      }
    } finally {
      this._iniciando = false;
    }
  }

  _iniciarFilho(s, { comando, pareamento = null }) {
    let filho;
    try {
      filho = this._fork(s.id);
    } catch (e) {
      this.log(`não consegui criar o processo da sessão ${s.id}: ${e.message}`, 'erro');
      s.proximoInicio = this.agora() + 60_000;
      return;
    }
    s.filho = filho;
    s.ordem = comando === 'desconectar' ? 'desconectar' : null;
    s.inicioEm = this.agora();
    s.conexao = null;
    filho.on('message', (m) => this._aoMensagemDoFilho(s, filho, m));
    filho.on('exit', (codigo) => this._aoSairFilho(s, filho, codigo));
    filho.on('error', (e) => this.log(`sessão ${s.id}: ${e.message}`, 'erro'));
    // Voltou a rodar: a contagem dos 7 dias parada recomeça do zero na próxima parada.
    if (comando !== 'desconectar') void this._apagarMarcaParada(s.id);
    this._mandar(s, comando === 'desconectar' ? { tipo: 'desconectar', opcoes: s.opcoes } : { tipo: 'iniciar', opcoes: s.opcoes, pareamento });
  }

  _mandar(s, msg) {
    try {
      s.filho?.send(msg);
      return true;
    } catch (e) {
      this.log(`sessão ${s.id} não recebeu "${msg.tipo}": ${e.message}`, 'aviso');
      return false;
    }
  }

  _aoMensagemDoFilho(s, filho, m) {
    if (s.filho !== filho) return;
    if (m?.tipo === 'fila') void this.buscarFila();
    if (m?.tipo === 'estado') s.conexao = m.conexao;
  }

  _aoSairFilho(s, filho, codigo) {
    if (s.filho !== filho) return;
    s.filho = null;
    s.ordem = null;
    s.conexao = null;
    const motivo = MOTIVO_DA_SAIDA[codigo];
    if (motivo === 'desconectada') this._desconexaoPedida.delete(s.id);
    if (motivo === 'parada') {
      // Parou, mas no meio veio "desconectar" ou "voltar a rodar": não espera os 60 s.
      if ((s.desconectar || s.deveRodar) && !this._encerrando) void this.sincronizar();
      return;
    }
    if (motivo === 'precisa_parear' || motivo === 'deslogado' || motivo === 'fatal' || motivo === 'desconectada') {
      s.bloqueado = { motivo, em: this.agora() };
      this.log(`sessão ${s.id} parou: ${motivo}`, motivo === 'fatal' ? 'erro' : 'info');
      return;
    }
    // Caiu (exceção, memória): religa com espera crescente, de 10 s até 10 min.
    s.falhas = this.agora() - s.inicioEm > 10 * 60_000 ? 1 : s.falhas + 1;
    const espera = Math.min(10 * 60_000, 10_000 * 2 ** (s.falhas - 1));
    s.proximoInicio = this.agora() + espera;
    this.log(`sessão ${s.id} caiu (código ${codigo}); religo em ${Math.round(espera / 1000)} s`, 'aviso');
    if (!this._encerrando) {
      const t = setTimeout(() => void this.sincronizar(), espera + 100);
      t.unref?.();
    }
  }

  /* ---------------- fila de saída ---------------- */

  /** Busca a fila agregada e entrega cada mensagem à sessão dela. */
  async buscarFila() {
    if (this._buscandoFila) { this._buscarDeNovo = true; return; }
    this._buscandoFila = true;
    try {
      for (let rodada = 0; rodada < 5 && !this._encerrando; rodada++) {
        let resp;
        try {
          resp = await this.transporte.fila(LIMITE_FILA);
        } catch (e) {
          this.log(`não consegui ler a fila no CRM: ${e.message}`, 'aviso');
          return;
        }
        const mensagens = Array.isArray(resp?.mensagens) ? resp.mensagens : [];
        const porConexao = new Map();
        for (const m of mensagens) {
          if (!m?.id || !m.conexaoId) continue;
          if (!porConexao.has(m.conexaoId)) porConexao.set(m.conexaoId, []);
          porConexao.get(m.conexaoId).push(m);
        }
        for (const [conexaoId, lista] of porConexao) {
          const s = this.sessoes.get(conexaoId);
          // A reserva já foi feita: quem não tem sessão viva devolve erro, senão a mensagem fica presa.
          if (!s?.filho || !this._mandar(s, { tipo: 'enviar', mensagens: lista })) {
            for (const m of lista) {
              await this.transporte.confirmar({ id: m.id, status: 'erro', erro: 'sessao_parada' })
                .catch((e) => this.log(`não consegui devolver ${m.id}: ${e.message}`, 'aviso'));
            }
          }
        }
        if (mensagens.length < LIMITE_FILA) break;
      }
    } finally {
      this._buscandoFila = false;
      if (this._buscarDeNovo && !this._encerrando) { this._buscarDeNovo = false; void this.buscarFila(); }
    }
  }

  /* ---------------- pastas de sessões paradas (LGPD) ---------------- */

  async _existePasta(id) {
    return !!(await stat(join(this.pastaSessoes, id)).catch(() => null));
  }

  _arqMarca(id) { return join(this.pastaSessoes, id, 'parada.json'); }

  async _apagarMarcaParada(id) {
    await rm(this._arqMarca(id), { force: true }).catch(() => {});
  }

  /**
   * Quem tem a pasta da sessão tem o WhatsApp do mentorado. Pasta de conexão que não
   * roda mais (deveRodar=false ou fora da lista) é marcada; depois de 7 dias assim,
   * a sessão sai do aparelho e a pasta é apagada.
   */
  async _limparPastasParadas(naLista, lista, agora) {
    let pastas = [];
    try { pastas = (await readdir(this.pastaSessoes, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return; }
    const deveRodar = new Set(lista.filter((c) => c.deveRodar === true).map((c) => c.id));
    for (const id of pastas) {
      if (!ID_VALIDO.test(id) || deveRodar.has(id)) continue;
      const s = this.sessoes.get(id);
      if (s?.filho || s?.naFilaDeInicio) continue;
      let desde = null;
      try { desde = Date.parse(JSON.parse(await readFile(this._arqMarca(id), 'utf8')).desde); } catch { /* sem marca */ }
      if (!Number.isFinite(desde)) {
        await gravarAtomico(this._arqMarca(id), JSON.stringify({ desde: new Date(agora).toISOString(), naLista: naLista.has(id) })).catch(() => {});
        continue;
      }
      if (agora - desde > RETER_PARADA_DIAS * 86400_000) {
        this.log(`sessão ${id} parada há mais de ${RETER_PARADA_DIAS} dias: saindo do aparelho e apagando a pasta`, 'aviso');
        this._iniciarFilho(this._sessao(id), { comando: 'desconectar' });
      }
    }
  }

  /* ---------------- desligar ---------------- */

  async encerrar(prazoMs = 20_000) {
    this._encerrando = true;
    for (const t of this._timers) clearInterval(t);
    const vivos = [...this.sessoes.values()].filter((s) => s.filho);
    const saidas = vivos.map((s) => new Promise((r) => { s.filho.once('exit', r); }));
    for (const s of vivos) this._mandar(s, { tipo: 'parar' });
    await Promise.race([Promise.all(saidas), this.esperar(prazoMs)]);
    for (const s of vivos) if (s.filho) { try { s.filho.kill('SIGKILL'); } catch { /* já saiu */ } }
  }
}
