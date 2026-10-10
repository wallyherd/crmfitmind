// mapear.mjs — transforma o que o Baileys 6.7.24 entrega nos eventos do CONTRATO.md.
//
// Tudo aqui é puro: sem rede, sem disco e sem relógio próprio. O que depende de
// estado da sessão (mapa LID -> telefone, grupos permitidos, nomes de grupo, o
// "agora") entra pelo parâmetro `ctx`. Por isso os testes rodam sem o Baileys
// instalado. Os trechos copiados do Baileys citam o arquivo de origem.

import { createHash } from 'node:crypto';

/* ------------------------------------------------------------------ */
/* constantes do protocolo (WAProto do 6.7.24)                          */
/* ------------------------------------------------------------------ */

export const STATUS_WA = { ERROR: 0, PENDING: 1, SERVER_ACK: 2, DELIVERY_ACK: 3, READ: 4, PLAYED: 5 };
export const TIPO_PROTOCOLO = { REVOKE: 0, MESSAGE_EDIT: 14 };
export const STUB = { REVOKE: 1, CIPHERTEXT: 2 };
export const LIMITE_CORPO = 10000;
export const CHATS_POR_EVENTO = 200;
/** Acima disso um 'notify' já não é "tempo real": o buffer do Baileys rotula o lote pelo 1º. */
export const IDADE_MAX_TEMPO_REAL_S = 120;

/* ------------------------------------------------------------------ */
/* jid (cópia de lib/WABinary/jid-utils.js)                             */
/* ------------------------------------------------------------------ */

export const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');

export function jidDecode(jid) {
  const i = typeof jid === 'string' ? jid.indexOf('@') : -1;
  if (i < 0) return undefined;
  const server = jid.slice(i + 1);
  const [userAgent, device] = jid.slice(0, i).split(':');
  return { server, user: userAgent.split('_')[0], device: device ? +device : undefined };
}

/** Tira o ":device" e o "_agente"; c.us vira s.whatsapp.net. */
export function jidNormalizado(jid) {
  const d = jidDecode(jid);
  if (!d) return '';
  return `${d.user || ''}@${d.server === 'c.us' ? 's.whatsapp.net' : d.server}`;
}

export const ehGrupo = (j) => typeof j === 'string' && j.endsWith('@g.us');
export const ehLid = (j) => typeof j === 'string' && j.endsWith('@lid');
export const ehTelefone = (j) => typeof j === 'string' && j.endsWith('@s.whatsapp.net');
/** Só conversa 1:1 (telefone ou LID) e grupo. Status, lista de transmissão, canal e bot ficam de fora. */
export const ehChatCapturavel = (j) => ehTelefone(j) || ehLid(j) || ehGrupo(j);
export const mesmoUsuario = (a, b) => !!a && !!b && jidDecode(a)?.user === jidDecode(b)?.user;

/** Telefone só em dígitos, E.164 sem o "+", ou null. */
const telefoneDeJid = (jid) => (ehTelefone(jid) ? soDigitos(jidDecode(jid).user) || null : null);

/* ------------------------------------------------------------------ */
/* números e datas                                                      */
/* ------------------------------------------------------------------ */

/** Long do protobuf vira number (cópia de lib/Utils/generics.js). */
export const toNumber = (t) =>
  typeof t === 'object' && t ? ('toNumber' in t ? t.toNumber() : t.low) : Number(t) || 0;

/** Segundos unix do WhatsApp -> ISO. Sem horário válido usa o "agora" do chamador. */
export function isoDeSegundos(ts, agoraMs) {
  const s = toNumber(ts);
  return new Date(s > 0 ? s * 1000 : agoraMs).toISOString();
}

/* ------------------------------------------------------------------ */
/* conteúdo                                                             */
/* ------------------------------------------------------------------ */

// Envelopes que só embrulham a mensagem de verdade. Os seis primeiros são os do
// normalizeMessageContent (lib/Utils/messages.js:564); os três últimos também são
// FutureProofMessage e trariam a mensagem como "outro" se não fossem abertos.
const ENVELOPES = [
  'ephemeralMessage', 'viewOnceMessage', 'documentWithCaptionMessage', 'viewOnceMessageV2',
  'viewOnceMessageV2Extension', 'editedMessage', 'associatedChildMessage', 'lottieStickerMessage',
  'groupMentionedMessage',
];
const VISUALIZACAO_UNICA = new Set(['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension']);

/** Abre efêmera, visualização única, documento com legenda e editada. Diz se passou por visualização única. */
export function normalizarConteudo(bruto) {
  let c = bruto || undefined;
  let visualizacaoUnica = false;
  for (let i = 0; i < 5 && c; i++) {
    const env = ENVELOPES.find((k) => c[k]);
    if (!env) break;
    if (VISUALIZACAO_UNICA.has(env)) visualizacaoUnica = true;
    c = c[env]?.message || undefined;
  }
  return { conteudo: c, visualizacaoUnica };
}

/** Cópia de getContentType (lib/Utils/messages.js:551). */
export function tipoDoConteudo(c) {
  if (!c) return undefined;
  return Object.keys(c).find(
    (k) => (k === 'conversation' || k.includes('Message')) && k !== 'senderKeyDistributionMessage' && c[k] != null,
  );
}

const TIPO_MIDIA = {
  conversation: 'texto', extendedTextMessage: 'texto',
  buttonsResponseMessage: 'texto', listResponseMessage: 'texto', templateButtonReplyMessage: 'texto',
  interactiveResponseMessage: 'texto', buttonsMessage: 'texto', templateMessage: 'texto',
  interactiveMessage: 'texto', listMessage: 'texto',
  imageMessage: 'imagem', videoMessage: 'video', ptvMessage: 'video',
  audioMessage: 'audio', documentMessage: 'documento', stickerMessage: 'figurinha',
  locationMessage: 'localizacao', liveLocationMessage: 'localizacao',
  contactMessage: 'contato', contactsArrayMessage: 'contato',
  pollCreationMessage: 'enquete', pollCreationMessageV2: 'enquete', pollCreationMessageV3: 'enquete',
  pollCreationMessageV4: 'enquete', pollCreationMessageV5: 'enquete',
  reactionMessage: 'reacao',
};

// Não são fala de ninguém: sinalização, voto, fixar, chave de grupo, o "anúncio"
// de álbum (as fotos chegam uma a uma), histórico. protocolMessage é tratado à parte.
const NAO_E_FALA = new Set([
  'protocolMessage', 'senderKeyDistributionMessage', 'fastRatchetKeySenderKeyDistributionMessage',
  'pollUpdateMessage', 'keepInChatMessage', 'pinInChatMessage', 'encReactionMessage',
  'encEventResponseMessage', 'encCommentMessage', 'messageHistoryBundle', 'messageHistoryNotice',
  'albumMessage', 'stickerSyncRmrMessage', 'secretEncryptedMessage', 'placeholderMessage',
  'deviceSentMessage', 'botInvokeMessage', 'statusMentionMessage', 'groupStatusMentionMessage',
  'statusAddYours', 'groupStatusMessage', 'statusNotificationMessage', 'callLogMesssage', 'bcallMessage',
]);

const texto = (v, max = LIMITE_CORPO) => {
  if (v == null) return null;
  // O Postgres recusa \u0000 em text e em jsonb.
  const s = String(v).replace(/\u0000/g, '');
  return s ? s.slice(0, max) : null;
};

function corpoDe(chave, x, c) {
  switch (chave) {
    case 'conversation': return texto(c.conversation);
    case 'extendedTextMessage': return texto(x.text);
    case 'imageMessage': case 'videoMessage': case 'ptvMessage': case 'documentMessage':
      return texto(x.caption);
    case 'liveLocationMessage': return texto(x.caption);
    case 'locationMessage': return texto([x.name, x.address, x.comment].filter(Boolean).join(' — '));
    case 'contactMessage': return texto(x.displayName);
    case 'contactsArrayMessage':
      return texto(x.displayName || (x.contacts || []).map((k) => k?.displayName).filter(Boolean).join(', '));
    case 'buttonsResponseMessage': case 'templateButtonReplyMessage': return texto(x.selectedDisplayText);
    case 'listResponseMessage': return texto(x.title || x.singleSelectReply?.selectedRowId);
    case 'interactiveResponseMessage': return texto(x.body?.text);
    case 'buttonsMessage': return texto(x.contentText || x.text);
    case 'templateMessage':
      return texto(x.hydratedTemplate?.hydratedContentText || x.hydratedFourRowTemplate?.hydratedContentText);
    case 'interactiveMessage': return texto(x.body?.text);
    case 'listMessage': return texto(x.description || x.title);
    case 'reactionMessage': return texto(x.text);
    case 'pollCreationMessage': case 'pollCreationMessageV2': case 'pollCreationMessageV3':
    case 'pollCreationMessageV4': case 'pollCreationMessageV5': {
      const opcoes = (x.options || []).map((o) => o?.optionName).filter(Boolean);
      return texto(opcoes.length ? `${x.name || ''} (opções: ${opcoes.join(' / ')})` : x.name);
    }
    case 'eventMessage': return texto(x.name);
    case 'groupInviteMessage': return texto(x.groupName || x.caption);
    default: return texto(x.caption ?? x.text ?? x.title ?? x.name ?? null);
  }
}

/**
 * Lê o conteúdo de uma mensagem do Baileys.
 * Devolve null para o que não é fala (protocolo, voto, chave de grupo...).
 */
export function lerConteudo(bruto) {
  const { conteudo: c, visualizacaoUnica } = normalizarConteudo(bruto);
  const chave = tipoDoConteudo(c);
  if (!c || !chave || NAO_E_FALA.has(chave)) return null;
  const x = chave === 'conversation' ? {} : c[chave] || {};
  const tipoMidia = TIPO_MIDIA[chave] || 'outro';

  const midia = {};
  if (['imagem', 'video', 'audio', 'documento', 'figurinha'].includes(tipoMidia)) {
    if (x.mimetype) midia.mimetype = String(x.mimetype).slice(0, 120);
    const seg = toNumber(x.seconds);
    if (seg > 0 && (tipoMidia === 'audio' || tipoMidia === 'video')) midia.duracaoSeg = seg;
    if (tipoMidia === 'audio') midia.ptt = !!x.ptt;
    if (x.fileName) midia.nomeArquivo = String(x.fileName).replace(/\u0000/g, '').slice(0, 200);
    const tam = toNumber(x.fileLength);
    if (tam > 0) midia.tamanho = tam;
  }
  if (visualizacaoUnica || x.viewOnce) midia.visualizacaoUnica = true;

  return {
    chave,
    tipoMidia,
    corpo: corpoDe(chave, x, c),
    midia: Object.keys(midia).length ? midia : null,
    ctx: x.contextInfo || null,
    reacaoAlvo: chave === 'reactionMessage' ? x.key?.id || null : null,
  };
}

/**
 * Anúncio Click-to-WhatsApp e porta de entrada, como vieram.
 * Quem decide se é tráfego pago é o servidor (C3): aqui só se copia o bruto.
 */
export function lerAnuncio(ctx) {
  if (!ctx) return null;
  const ad = ctx.externalAdReply || {};
  const bruto = {
    sourceType: texto(ad.sourceType, 100),
    sourceId: texto(ad.sourceId, 200),
    sourceUrl: texto(ad.sourceUrl, 1000),
    ctwaClid: texto(ad.ctwaClid, 500),
    titulo: texto(ad.title, 500),
    corpo: texto(ad.body, 2000),
    conversionSource: texto(ctx.conversionSource, 200),
    entryPointConversionSource: texto(ctx.entryPointConversionSource, 200),
    entryPointConversionApp: texto(ctx.entryPointConversionApp, 200),
  };
  const sinal = bruto.ctwaClid || bruto.sourceId || bruto.sourceUrl || bruto.sourceType ||
    bruto.conversionSource || bruto.entryPointConversionSource || bruto.entryPointConversionApp;
  if (!sinal) return null;
  return Object.fromEntries(Object.entries(bruto).filter(([, v]) => v != null));
}

/* ------------------------------------------------------------------ */
/* LID <-> telefone                                                     */
/* ------------------------------------------------------------------ */

/**
 * O 6.7.24 não tem mapa LID -> telefone embutido; a sessão guarda o seu.
 * Esta classe só guarda os pares; quem persiste é a sessão (lids.json).
 */
export class MapaLid {
  constructor(objeto = {}) {
    this.lidParaPn = new Map();
    this.pnParaLid = new Map();
    for (const [lid, pn] of Object.entries(objeto || {})) this.aprender(lid, pn);
  }
  /** true se o par é novo ou mudou. */
  aprender(lid, pn) {
    const l = jidNormalizado(lid);
    const p = jidNormalizado(pn);
    if (!ehLid(l) || !ehTelefone(p)) return false;
    if (this.lidParaPn.get(l) === p) return false;
    this.lidParaPn.set(l, p);
    this.pnParaLid.set(p, l);
    return true;
  }
  pnDe(lid) { return this.lidParaPn.get(jidNormalizado(lid)) || null; }
  lidDe(pn) { return this.pnParaLid.get(jidNormalizado(pn)) || null; }
  get tamanho() { return this.lidParaPn.size; }
  paraObjeto() { return Object.fromEntries(this.lidParaPn); }
}

/** Pares [lid, telefoneJid] que a própria chave da mensagem revela (lib/Utils/decode-wa-message.js:90). */
export function paresLid(m) {
  const k = m?.key || {};
  const chat = jidNormalizado(k.remoteJid);
  const pares = [];
  // sender_pn/sender_lid descrevem quem mandou; numa mensagem minha, descreveriam a mim.
  if (k.fromMe) return pares;
  if (ehGrupo(chat)) {
    const p = jidNormalizado(k.participant || m.participant);
    if (ehLid(p) && k.participantPn) pares.push([p, k.participantPn]);
    if (ehTelefone(p) && k.participantLid) pares.push([k.participantLid, p]);
  } else {
    if (ehLid(chat) && k.senderPn) pares.push([chat, k.senderPn]);
    if (ehTelefone(chat) && k.senderLid) pares.push([k.senderLid, chat]);
  }
  return pares.filter(([l, p]) => ehLid(jidNormalizado(l)) && ehTelefone(jidNormalizado(p)));
}

/** Pares que vêm de contatos (contacts.upsert/update e histórico) e da lista de chats do histórico. */
export function paresLidDeContatos(contatos = [], chats = []) {
  const pares = [];
  for (const c of contatos || []) {
    if (!c) continue;
    const pn = c.jid || (ehTelefone(jidNormalizado(c.id)) ? c.id : null);
    const lid = c.lid || (ehLid(jidNormalizado(c.id)) ? c.id : null);
    if (pn && lid) pares.push([lid, pn]);
  }
  for (const c of chats || []) {
    if (!c?.id) continue;
    if (c.lidJid && ehTelefone(jidNormalizado(c.id))) pares.push([c.lidJid, c.id]);
    if (c.pnJid && ehLid(jidNormalizado(c.id))) pares.push([c.id, c.pnJid]);
  }
  return pares;
}

/* ------------------------------------------------------------------ */
/* contexto                                                             */
/* ------------------------------------------------------------------ */

/**
 * ctx = {
 *   agora: ms,                      // relógio do chamador
 *   gruposPermitidos: Set<jid>,     // grupos que o mentorado marcou
 *   nomesGrupos: Map<jid, nome>,
 *   lids: MapaLid,
 *   meusJids: string[],             // meu telefone e meu LID: "conversa comigo mesmo" fica de fora
 * }
 */
function chatPermitido(chat, ctx) {
  if (!ehChatCapturavel(chat)) return false;
  if ((ctx.meusJids || []).some((eu) => mesmoUsuario(eu, chat))) return false;
  if (ehGrupo(chat)) return !!ctx.gruposPermitidos?.has(chat);
  return true;
}

/** origemEvento a partir do `type` do messages.upsert. */
export function origemDoUpsert(tipo, waEmIso, agoraMs) {
  if (tipo !== 'notify') return 'offline';
  const idade = (agoraMs - Date.parse(waEmIso)) / 1000;
  return idade > IDADE_MAX_TEMPO_REAL_S ? 'offline' : 'tempo_real';
}

/* ------------------------------------------------------------------ */
/* mensagem, edição, apagada                                            */
/* ------------------------------------------------------------------ */

/**
 * Uma mensagem do Baileys (messages.upsert ou histórico) vira um evento do contrato.
 * `origem`: 'notify' | 'append' | 'historico'. Devolve null quando não há o que contar.
 */
export function mapearMensagem(m, origem, ctx) {
  const k = m?.key || {};
  const chat = jidNormalizado(k.remoteJid);
  if (!k.id || !chatPermitido(chat, ctx)) return null;

  const agora = ctx.agora ?? Date.now();
  const waEm = isoDeSegundos(m.messageTimestamp, agora);
  const origemEvento = origem === 'historico' ? 'historico' : origemDoUpsert(origem, waEm, agora);

  // Editar e apagar chegam como protocolMessage dentro do próprio upsert.
  const { conteudo } = normalizarConteudo(m.message);
  const pm = conteudo?.protocolMessage;
  if (pm) {
    const alvo = pm.key?.id;
    if (!alvo) return null;
    // O id alvo vem de dentro do conteúdo, que o remetente controla. Editar e apagar só valem para
    // mensagem do mesmo chat; quem manda (deMim/participanteJid) segue junto para o servidor
    // conferir que é o autor da mensagem original.
    if (pm.key?.remoteJid && jidNormalizado(pm.key.remoteJid) !== chat) return null;
    const autoria = { deMim: !!k.fromMe };
    if (ehGrupo(chat) && !k.fromMe) autoria.participanteJid = jidNormalizado(k.participant || m.participant) || null;
    if (pm.type === TIPO_PROTOCOLO.REVOKE) return { tipo: 'apagada', waId: alvo, chatJid: chat, ...autoria, waEm };
    if (pm.type === TIPO_PROTOCOLO.MESSAGE_EDIT) {
      const ms = toNumber(pm.timestampMs);
      return {
        tipo: 'edicao',
        waId: alvo,
        chatJid: chat,
        ...autoria,
        corpo: lerConteudo(pm.editedMessage)?.corpo ?? null,
        waEm: ms > 0 ? new Date(ms).toISOString() : waEm,
      };
    }
    return null;
  }

  let ct = lerConteudo(m.message);
  if (!ct) {
    // Visualização única não chega aos aparelhos conectados: vem sem conteúdo e com a marca.
    if (k.isViewOnce && m.messageStubType === STUB.CIPHERTEXT) {
      ct = { tipoMidia: 'outro', corpo: null, midia: { visualizacaoUnica: true }, ctx: null, reacaoAlvo: null };
    } else {
      return null;
    }
  }
  // Tirar a reação não é fala.
  if (ct.tipoMidia === 'reacao' && !ct.corpo) return null;

  const deMim = !!k.fromMe;
  const grupo = ehGrupo(chat);
  const lids = ctx.lids || new MapaLid();
  for (const [l, p] of paresLid(m)) lids.aprender(l, p);

  let telefone = null;
  let lid = null;
  if (!grupo) {
    if (ehLid(chat)) {
      lid = chat;
      telefone = telefoneDeJid(lids.pnDe(chat));
    } else {
      telefone = telefoneDeJid(chat);
      lid = lids.lidDe(chat);
    }
  }

  let participanteJid = null;
  let participanteTelefone = null;
  let participanteNome = null;
  if (grupo && !deMim) {
    participanteJid = jidNormalizado(k.participant || m.participant) || null;
    if (participanteJid) {
      participanteTelefone = ehLid(participanteJid)
        ? telefoneDeJid(lids.pnDe(participanteJid))
        : telefoneDeJid(participanteJid);
    }
    participanteNome = texto(m.pushName, 120);
  }

  return {
    tipo: 'mensagem',
    waId: k.id,
    chatJid: chat,
    grupo,
    grupoNome: grupo ? ctx.nomesGrupos?.get(chat) || null : null,
    telefone,
    telefoneConfirmado: !!telefone,
    lid,
    // pushName de mensagem minha é o nome do mentorado, não o do contato.
    nome: !deMim && !grupo ? texto(m.pushName, 120) : null,
    deMim,
    participanteJid,
    participanteTelefone,
    participanteNome,
    tipoMidia: ct.tipoMidia,
    corpo: ct.corpo,
    midia: ct.midia,
    citadoWaId: ct.reacaoAlvo || texto(ct.ctx?.stanzaId, 120),
    anuncio: deMim || grupo ? null : lerAnuncio(ct.ctx),
    origemEvento,
    waEm,
  };
}

/* ------------------------------------------------------------------ */
/* recibos                                                              */
/* ------------------------------------------------------------------ */

const STATUS_RECIBO = {
  [STATUS_WA.DELIVERY_ACK]: 'entregue',
  [STATUS_WA.READ]: 'lida',
  [STATUS_WA.PLAYED]: 'reproduzida',
};

/**
 * messages.update -> recibos de conversa 1:1.
 * deMim + entregue/lida/reproduzida = o cliente recebeu/viu o que o mentorado mandou.
 * !deMim + lida/reproduzida         = o mentorado viu/ouviu no celular o que o cliente mandou.
 * Apagar e editar também passam por messages.update, mas já saem do upsert: aqui são ignorados.
 */
export function mapearRecibos(atualizacoes, ctx) {
  const agora = new Date(ctx.agora ?? Date.now()).toISOString();
  const eventos = [];
  for (const u of atualizacoes || []) {
    const k = u?.key || {};
    const chat = jidNormalizado(k.remoteJid);
    if (!k.id || ehGrupo(chat) || !chatPermitido(chat, ctx)) continue;
    const status = STATUS_RECIBO[u.update?.status];
    if (!status) continue;
    if (!k.fromMe && status === 'entregue') continue;
    eventos.push({ tipo: 'recibo', waId: k.id, chatJid: chat, deMim: !!k.fromMe, status, em: agora });
  }
  return eventos;
}

/**
 * Recibo que veio grudado na própria mensagem. Enquanto o Baileys segura os eventos
 * (sessão voltando, lote offline), o messages.update de uma mensagem que está no mesmo
 * lote é fundido nela (lib/Utils/event-buffer.js:309) e nunca sai como recibo.
 * `ev` é o evento 'mensagem' já mapeado. Só 1:1; grupo tem recibo por participante.
 */
export function reciboEmbutido(m, ev, ctx) {
  if (ev?.tipo !== 'mensagem' || ev.grupo || ev.origemEvento === 'historico') return null;
  const status = STATUS_RECIBO[m?.status];
  if (!status || (!ev.deMim && status === 'entregue')) return null;
  return { tipo: 'recibo', waId: ev.waId, chatJid: ev.chatJid, deMim: ev.deMim, status, em: new Date(ctx.agora ?? Date.now()).toISOString() };
}

/** message-receipt.update -> recibos de grupo (só grupo marcado e só mensagem do mentorado). */
export function mapearRecibosGrupo(recibos, ctx) {
  const eventos = [];
  for (const r of recibos || []) {
    const k = r?.key || {};
    const chat = jidNormalizado(k.remoteJid);
    if (!k.id || !k.fromMe || !ehGrupo(chat) || !chatPermitido(chat, ctx)) continue;
    const rc = r.receipt || {};
    const [status, ts] = toNumber(rc.playedTimestamp) ? ['reproduzida', rc.playedTimestamp]
      : toNumber(rc.readTimestamp) ? ['lida', rc.readTimestamp]
        : toNumber(rc.receiptTimestamp) ? ['entregue', rc.receiptTimestamp]
          : [null, null];
    if (!status) continue;
    eventos.push({ tipo: 'recibo', waId: k.id, chatJid: chat, deMim: true, status, em: isoDeSegundos(ts, ctx.agora ?? Date.now()) });
  }
  return eventos;
}

/* ------------------------------------------------------------------ */
/* grupos e base de chats                                               */
/* ------------------------------------------------------------------ */

/** groupFetchAllParticipating() -> evento 'grupos'. Só a contagem de participantes, nunca os números. */
export function mapearGrupos(grupos) {
  const lista = Array.isArray(grupos) ? grupos : Object.values(grupos || {});
  return {
    tipo: 'grupos',
    grupos: lista
      .filter((g) => ehGrupo(g?.id))
      .map((g) => ({ jid: g.id, nome: texto(g.subject, 200), participantes: (g.participants || []).length }))
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR')),
  };
}

/**
 * Lista de conversas do histórico, SEM corpo (V11): semeia os contatos antigos,
 * para cliente antigo que volta não contar como conversa nova.
 */
export function mapearChatsBase(chats, ctx) {
  const lids = ctx.lids || new MapaLid();
  const agora = ctx.agora ?? Date.now();
  const itens = [];
  const vistos = new Set();
  for (const c of chats || []) {
    const jid = jidNormalizado(c?.id);
    if (!jid || ehGrupo(jid) || !chatPermitido(jid, ctx) || vistos.has(jid)) continue;
    vistos.add(jid);
    const lid = ehLid(jid) ? jid : jidNormalizado(c.lidJid) || lids.lidDe(jid) || null;
    const pn = ehTelefone(jid) ? jid : jidNormalizado(c.pnJid) || lids.pnDe(jid) || null;
    const ultimo = Math.max(toNumber(c.conversationTimestamp), toNumber(c.lastMessageRecvTimestamp), toNumber(c.lastMsgTimestamp));
    itens.push({
      jid,
      telefone: telefoneDeJid(pn),
      lid: lid || null,
      nome: texto(c.name || c.displayName || c.username, 120),
      ultimoEm: ultimo > 0 ? isoDeSegundos(ultimo, agora) : null,
    });
  }
  const eventos = [];
  for (let i = 0; i < itens.length; i += CHATS_POR_EVENTO) {
    eventos.push({ tipo: 'chats_base', chats: itens.slice(i, i + CHATS_POR_EVENTO) });
  }
  return eventos;
}

/* ------------------------------------------------------------------ */
/* fila de saída                                                        */
/* ------------------------------------------------------------------ */

/**
 * ID da mensagem enviada pela fila, derivado do id do servidor.
 * Mesmo formato do Baileys (3EB0 + 18 hex) para não destoar de um WhatsApp Web
 * comum; determinístico para o servidor poder reconhecer o eco antes do /confirmar
 * e para um reenvio depois de queda sair com o mesmo id (o WhatsApp descarta o repetido).
 */
export function waIdDaFila(id) {
  return '3EB0' + createHash('sha256').update(`fila:${id}`).digest('hex').toUpperCase().slice(0, 18);
}

/**
 * "65 9 9999-0000" -> "5565999990000". Com "+" na frente o DDI já veio e nada se acrescenta;
 * sem "+", 10 ou 11 dígitos têm cara de DDD + número do Brasil e ganham o 55.
 */
export function telefoneParaPareamento(telefone) {
  const d = soDigitos(telefone);
  if (String(telefone ?? '').trim().startsWith('+')) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}
