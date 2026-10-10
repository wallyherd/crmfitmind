// spool.mjs — fila em disco dos eventos que ainda não subiram para o CRM.
//
// Um arquivo JSONL por conexão. Cada gravação reescreve o arquivo inteiro a
// partir da memória (tmp + rename), e gravações pedidas durante outra são
// juntadas numa só: o disco nunca fica com um estado que a memória não teve.

import { readFile, writeFile, rename, unlink, appendFile, stat, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let contadorTmp = 0;

export async function gravarAtomico(arquivo, conteudo) {
  await mkdir(dirname(arquivo), { recursive: true, mode: 0o700 });
  const tmp = `${arquivo}.${process.pid}.${++contadorTmp}.tmp`;
  await writeFile(tmp, conteudo, { encoding: 'utf8', mode: 0o600 });
  // No Windows o rename falha se um antivírus estiver lendo o destino; tenta de novo.
  for (let i = 0; ; i++) {
    try { await rename(tmp, arquivo); return; } catch (e) {
      if (i >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      await esperar(50 * (i + 1));
    }
  }
}

export class Spool {
  /**
   * @param {string} arquivo  pendentes.jsonl
   * @param {{ rejeitados?: string, log?: (texto: string, tipo?: string) => void }} [op]
   */
  constructor(arquivo, op = {}) {
    this.arquivo = arquivo;
    this.arquivoRejeitados = op.rejeitados || null;
    this.log = op.log || (() => {});
    /** @type {{ s: number, ev: object, f?: number }[]} */
    this.itens = [];
    this._seq = 0;
    this._sujo = false;
    this._gravando = null;
  }

  async carregar() {
    let bruto = '';
    try { bruto = await readFile(this.arquivo, 'utf8'); } catch (e) {
      if (e.code !== 'ENOENT') this.log(`fila local ilegível (${e.code}); começando vazia`, 'erro');
      return this;
    }
    let ruins = 0;
    for (const linha of bruto.split('\n')) {
      if (!linha.trim()) continue;
      try {
        const item = JSON.parse(linha);
        if (item && typeof item.ev === 'object') { this.itens.push(item); this._seq = Math.max(this._seq, Number(item.s) || 0); }
        else ruins++;
      } catch { ruins++; }
    }
    if (ruins) this.log(`fila local: ${ruins} linha(s) corrompida(s) ignorada(s)`, 'aviso');
    return this;
  }

  get tamanho() { return this.itens.length; }

  adicionar(eventos) {
    for (const ev of eventos) this.itens.push({ s: ++this._seq, ev });
    return this._agendar();
  }

  /** Os primeiros eventos, até `n` itens e cerca de `maxBytes` de JSON (sempre ao menos 1). */
  primeiros(n, maxBytes = Infinity) {
    const saida = [];
    let bytes = 0;
    for (const item of this.itens) {
      if (saida.length >= n) break;
      const tam = Buffer.byteLength(JSON.stringify(item.ev));
      if (saida.length && bytes + tam > maxBytes) break;
      saida.push(item);
      bytes += tam;
    }
    return saida;
  }

  remover(qtd) {
    if (qtd > 0) this.itens.splice(0, qtd);
    return this._agendar();
  }

  /** Conta uma falha de servidor no primeiro item (sobrevive a reinício). */
  marcarFalha() {
    if (!this.itens.length) return 0;
    this.itens[0].f = (this.itens[0].f || 0) + 1;
    this._agendar();
    return this.itens[0].f;
  }

  /** Guarda o evento recusado para diagnóstico (no máximo ~1 MB; o anterior vira .1). */
  async rejeitar(ev, erro) {
    if (!this.arquivoRejeitados) return;
    try {
      const st = await stat(this.arquivoRejeitados).catch(() => null);
      if (st && st.size > 1_000_000) await rename(this.arquivoRejeitados, `${this.arquivoRejeitados}.1`).catch(() => {});
      await appendFile(this.arquivoRejeitados, JSON.stringify({ em: new Date().toISOString(), erro: String(erro).slice(0, 300), ev }) + '\n', { mode: 0o600 });
    } catch (e) {
      this.log(`não consegui guardar o evento recusado: ${e.message}`, 'erro');
    }
  }

  /** Resolve quando o estado atual da memória estiver no disco. */
  async gravado() {
    while (this._gravando) await this._gravando;
  }

  _agendar() {
    this._sujo = true;
    if (!this._gravando) this._gravando = this._laco();
    return this._gravando;
  }

  async _laco() {
    try {
      while (this._sujo) {
        this._sujo = false;
        try {
          if (!this.itens.length) await unlink(this.arquivo).catch((e) => { if (e.code !== 'ENOENT') throw e; });
          else await gravarAtomico(this.arquivo, this.itens.map((i) => JSON.stringify(i)).join('\n') + '\n');
        } catch (e) {
          this.log(`não consegui gravar a fila local: ${e.message}`, 'erro');
          this._sujo = true; // tenta de novo na próxima mudança
          return;
        }
      }
    } finally {
      this._gravando = null;
    }
  }
}
