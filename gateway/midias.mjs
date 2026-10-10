// midias.mjs — comprovantes: imagem e PDF que o CLIENTE manda, do download até o CRM.
//
// O WhatsApp entrega o arquivo cifrado; o Baileys baixa e decifra. Aqui ficam as regras do que vale
// baixar, o download com teto de tamanho e a fila em disco dos arquivos que ainda não subiram
// (o CRM pode estar fora do ar). O envio em si é nuvem.mjs (POST /api/gateway/midia, HMAC sobre os bytes).

import { createHash } from 'node:crypto';
import { readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { gravarAtomico } from './spool.mjs';
import { ehLid, ehTelefone } from './mapear.mjs';

// A Vercel recebe até ~4,5 MB por chamada: 4 MB de arquivo é o teto. Maior que isso vira só metadado.
export const MAX_BYTES = 4 * 1024 * 1024;
export const MIMETYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

const MAX_PENDENTES = 200;
const MAX_BYTES_PENDENTES = 200 * 1024 * 1024;
export const IDADE_MAX_MS = 24 * 3600_000;   // arquivo que o CRM não aceitou em 24 h é descartado
export const MAX_TENTATIVAS_404 = 5;          // o CRM ainda não conhece a mensagem: 5 chances

/** 'image/jpeg; x=y' -> 'image/jpeg'; fora da lista -> null. */
export function mimetypeDe(valor) {
  const m = String(valor ?? '').split(';')[0].trim().toLowerCase();
  return MIMETYPES.has(m) ? m : null;
}

/**
 * Esta mensagem (já mapeada por mapearMensagem) merece o download?
 * Só imagem e PDF de um CLIENTE em conversa individual. Nunca grupo, nunca o que o próprio mentorado manda.
 * O histórico do pareamento fica de fora de propósito: baixar dezenas de arquivos de uma vez logo no pareamento
 * é tráfego atípico, e os links dos mais antigos costumam ter expirado.
 * @returns {{ baixar: true, mimetype: string } | { baixar: false, motivo: string }}
 */
export function avaliarMidia(ev) {
  const nao = (motivo) => ({ baixar: false, motivo });
  if (!ev || ev.tipo !== 'mensagem') return nao('nao_e_mensagem');
  if (ev.grupo || !(ehTelefone(ev.chatJid) || ehLid(ev.chatJid))) return nao('grupo');
  if (ev.deMim) return nao('de_mim');
  if (ev.tipoMidia !== 'imagem' && ev.tipoMidia !== 'documento') return nao('tipo');
  if (ev.origemEvento === 'historico') return nao('historico');
  if (ev.midia?.visualizacaoUnica) return nao('visualizacao_unica');
  const mimetype = mimetypeDe(ev.midia?.mimetype);
  if (!mimetype) return nao('mimetype');
  if (ev.midia?.tamanho > MAX_BYTES) return nao('grande');
  return { baixar: true, mimetype };
}

const loggerSilencioso = {
  level: 'silent',
  child() { return loggerSilencioso; },
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
};

/**
 * Baixa e decifra com o downloadMediaMessage do Baileys 6.7.24, em stream, parando assim que passa do teto
 * (o tamanho declarado na mensagem é do remetente e pode mentir).
 * @returns {Promise<{ buffer: Buffer } | { grande: true }>}
 */
export async function baixarMidiaBaileys(m, sock, { modulo, limite = MAX_BYTES } = {}) {
  const b = modulo || (await import('@whiskeysockets/baileys'));
  const stream = await b.downloadMediaMessage(
    m,
    'stream',
    { options: { timeout: 30_000 } },
    { reuploadRequest: (msg) => sock.updateMediaMessage(msg), logger: loggerSilencioso },
  );
  const partes = [];
  let total = 0;
  for await (const parte of stream) {
    total += parte.length;
    if (total > limite) {
      stream.destroy();
      return { grande: true };
    }
    partes.push(parte);
  }
  return { buffer: Buffer.concat(partes) };
}

const idDe = (waId) => createHash('sha256').update(String(waId)).digest('hex').slice(0, 32);

/**
 * Fila em disco: `<pasta>/<id>.bin` (os bytes) e `<pasta>/<id>.json` (waId, chatJid, mimetype, hora, tentativas).
 * O .json é gravado por último: arquivo sem .json é sobra de queda no meio e é apagado ao carregar.
 */
export class FilaMidia {
  /** @param {string} pasta  @param {{ log?: Function, agora?: () => number }} [op] */
  constructor(pasta, op = {}) {
    this.pasta = pasta;
    this.log = op.log || (() => {});
    this.agora = op.agora || Date.now;
    /** @type {Map<string, { id: string, waId: string, chatJid: string, mimetype: string, tamanho: number, em: number, t404?: number }>} */
    this.metas = new Map();
  }

  get tamanho() { return this.metas.size; }

  async carregar() {
    let nomes = [];
    try { nomes = await readdir(this.pasta); } catch (e) {
      if (e.code !== 'ENOENT') this.log(`pasta de comprovantes ilegível (${e.code})`, 'aviso');
      return this;
    }
    const comJson = new Set();
    for (const nome of nomes.filter((n) => n.endsWith('.json'))) {
      try {
        const meta = JSON.parse(await readFile(join(this.pasta, nome), 'utf8'));
        if (meta?.id && meta?.waId && nomes.includes(`${meta.id}.bin`)) { this.metas.set(meta.id, meta); comJson.add(meta.id); continue; }
      } catch { /* corrompido: sai abaixo */ }
      await unlink(join(this.pasta, nome)).catch(() => {});
    }
    for (const nome of nomes.filter((n) => n.endsWith('.bin') || n.includes('.tmp'))) {
      if (!comJson.has(nome.replace(/\.bin$/, ''))) await unlink(join(this.pasta, nome)).catch(() => {});
    }
    return this;
  }

  /** Lista da mais antiga para a mais nova. */
  listar() { return [...this.metas.values()].sort((a, b) => a.em - b.em); }

  get bytes() { return [...this.metas.values()].reduce((n, m) => n + (m.tamanho || 0), 0); }

  /** @returns {Promise<boolean>} false = não coube (fila cheia) ou já estava */
  async guardar({ waId, chatJid, mimetype, buffer }) {
    const id = idDe(waId);
    if (this.metas.has(id)) return false;
    if (this.metas.size >= MAX_PENDENTES || this.bytes + buffer.length > MAX_BYTES_PENDENTES) {
      this.log(`fila de comprovantes cheia (${this.metas.size} arquivo(s)); este ficou só como metadado`, 'aviso');
      return false;
    }
    const meta = { id, waId: String(waId), chatJid: String(chatJid), mimetype, tamanho: buffer.length, em: this.agora() };
    await gravarAtomico(join(this.pasta, `${id}.bin`), buffer);
    await gravarAtomico(join(this.pasta, `${id}.json`), JSON.stringify(meta));
    this.metas.set(id, meta);
    return true;
  }

  async ler(id) { return readFile(join(this.pasta, `${id}.bin`)); }

  async remover(id) {
    this.metas.delete(id);
    await unlink(join(this.pasta, `${id}.json`)).catch(() => {});
    await unlink(join(this.pasta, `${id}.bin`)).catch(() => {});
  }

  /** Conta uma resposta 404 ("o CRM ainda não conhece a mensagem") e devolve quantas já foram. */
  async contar404(id) {
    const meta = this.metas.get(id);
    if (!meta) return 0;
    meta.t404 = (meta.t404 || 0) + 1;
    await gravarAtomico(join(this.pasta, `${id}.json`), JSON.stringify(meta)).catch(() => {});
    return meta.t404;
  }
}
