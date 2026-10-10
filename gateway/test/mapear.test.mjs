// Mensagens no formato que o Baileys 6.7.24 entrega (key com senderPn/participantPn,
// messageTimestamp em segundos ou Long), conferidas contra o fonte do pacote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapearMensagem, mapearRecibos, mapearRecibosGrupo, mapearGrupos, mapearChatsBase, lerConteudo,
  normalizarConteudo, MapaLid, paresLid, paresLidDeContatos, waIdDaFila, telefoneParaPareamento,
  jidNormalizado, origemDoUpsert, reciboEmbutido,
} from '../mapear.mjs';

const AGORA = Date.parse('2026-10-07T15:00:00.000Z');
const TS = Math.floor(AGORA / 1000) - 30;            // 30 s atrás
const CLIENTE = '5565999990000@s.whatsapp.net';
const GRUPO = '120363000000000001@g.us';
const OUTRO_GRUPO = '120363000000000002@g.us';
const EU = '5565988887777:12@s.whatsapp.net';

const ctx = (extra = {}) => ({
  agora: AGORA,
  gruposPermitidos: new Set([GRUPO]),
  nomesGrupos: new Map([[GRUPO, 'Alunos turma 3']]),
  lids: new MapaLid(),
  meusJids: [EU, '99999999999@lid'],
  ...extra,
});

const msg = (message, key = {}, extra = {}) => ({
  key: { remoteJid: CLIENTE, fromMe: false, id: '3EB0AAAA', ...key },
  messageTimestamp: TS,
  pushName: 'João da Silva',
  message,
  ...extra,
});

test('texto de cliente 1:1 vira mensagem com telefone, nome e hora do WhatsApp', () => {
  const ev = mapearMensagem(msg({ conversation: 'Oi, quero saber o preço' }), 'notify', ctx());
  assert.deepEqual(ev, {
    tipo: 'mensagem', waId: '3EB0AAAA', chatJid: CLIENTE, grupo: false, grupoNome: null,
    telefone: '5565999990000', telefoneConfirmado: true, lid: null, nome: 'João da Silva', deMim: false,
    participanteJid: null, participanteTelefone: null, participanteNome: null,
    tipoMidia: 'texto', corpo: 'Oi, quero saber o preço', midia: null, citadoWaId: null, anuncio: null,
    origemEvento: 'tempo_real', waEm: new Date(TS * 1000).toISOString(),
  });
});

test('o que o mentorado digita no celular (fromMe) entra como deMim, sem o nome dele no contato', () => {
  const ev = mapearMensagem(
    msg({ extendedTextMessage: { text: 'Fechado, te mando o PIX', contextInfo: { stanzaId: '3EB0ORIG' } } }, { fromMe: true }, { pushName: 'Mentorado' }),
    'notify', ctx(),
  );
  assert.equal(ev.deMim, true);
  assert.equal(ev.nome, null);
  assert.equal(ev.corpo, 'Fechado, te mando o PIX');
  assert.equal(ev.citadoWaId, '3EB0ORIG');
  assert.equal(ev.telefone, '5565999990000');
});

test('grupo marcado entra com participante; o robô não tem como confundir com 1:1', () => {
  const m = msg({ conversation: 'Bom dia pessoal' }, {
    remoteJid: GRUPO, participant: '123456789012345@lid', participantPn: '5511912345678@s.whatsapp.net',
  }, { pushName: 'Maria' });
  const ev = mapearMensagem(m, 'notify', ctx());
  assert.equal(ev.grupo, true);
  assert.equal(ev.grupoNome, 'Alunos turma 3');
  assert.equal(ev.telefone, null);
  assert.equal(ev.telefoneConfirmado, false);
  assert.equal(ev.nome, null);
  assert.equal(ev.participanteJid, '123456789012345@lid');
  assert.equal(ev.participanteTelefone, '5511912345678');
  assert.equal(ev.participanteNome, 'Maria');
  assert.equal(ev.anuncio, null);
});

test('grupo não marcado não gera evento nenhum (nem edição, nem apagada, nem recibo)', () => {
  const c = ctx();
  assert.equal(mapearMensagem(msg({ conversation: 'x' }, { remoteJid: OUTRO_GRUPO, participant: CLIENTE }), 'notify', c), null);
  assert.equal(mapearMensagem(msg({ protocolMessage: { type: 0, key: { id: 'X' } } }, { remoteJid: OUTRO_GRUPO, participant: CLIENTE }), 'notify', c), null);
  assert.deepEqual(mapearRecibosGrupo([{ key: { remoteJid: OUTRO_GRUPO, id: 'A', fromMe: true }, receipt: { readTimestamp: TS } }], c), []);
});

test('status, canal, lista de transmissão e "conversa comigo mesmo" ficam de fora', () => {
  const c = ctx();
  for (const remoteJid of ['status@broadcast', '120363@newsletter', '12345@broadcast', '5565988887777@s.whatsapp.net', '99999999999@lid']) {
    assert.equal(mapearMensagem(msg({ conversation: 'x' }, { remoteJid }), 'notify', c), null, remoteJid);
  }
});

test('mensagem efêmera é aberta', () => {
  const ev = mapearMensagem(msg({ ephemeralMessage: { message: { extendedTextMessage: { text: 'some em 7 dias' } } } }), 'notify', ctx());
  assert.equal(ev.tipoMidia, 'texto');
  assert.equal(ev.corpo, 'some em 7 dias');
});

test('visualização única: aberta quando vem o conteúdo, marcada quando não vem', () => {
  const ev = mapearMensagem(msg({ viewOnceMessageV2: { message: { imageMessage: { caption: 'olha isso', mimetype: 'image/jpeg', viewOnce: true } } } }), 'notify', ctx());
  assert.equal(ev.tipoMidia, 'imagem');
  assert.equal(ev.corpo, 'olha isso');
  assert.equal(ev.midia.visualizacaoUnica, true);

  // No aparelho conectado o WhatsApp não entrega o conteúdo: vem stub CIPHERTEXT com key.isViewOnce.
  const semConteudo = { key: { remoteJid: CLIENTE, fromMe: false, id: '3EB0VO', isViewOnce: true }, messageTimestamp: TS, messageStubType: 2, messageStubParameters: ['Message absent from node'] };
  const ev2 = mapearMensagem(semConteudo, 'notify', ctx());
  assert.equal(ev2.tipoMidia, 'outro');
  assert.equal(ev2.corpo, null);
  assert.deepEqual(ev2.midia, { visualizacaoUnica: true });

  // Falha de decifração comum não vira mensagem vazia: a reentrega traz o conteúdo com o mesmo id.
  assert.equal(mapearMensagem({ ...semConteudo, key: { ...semConteudo.key, isViewOnce: undefined } }, 'notify', ctx()), null);
});

test('legenda de vídeo, de imagem e de documento', () => {
  const v = mapearMensagem(msg({ videoMessage: { caption: 'treino de hoje', seconds: 31, mimetype: 'video/mp4', fileLength: { low: 2048000, high: 0, toNumber: () => 2048000 } } }), 'notify', ctx());
  assert.equal(v.tipoMidia, 'video');
  assert.equal(v.corpo, 'treino de hoje');
  assert.deepEqual(v.midia, { mimetype: 'video/mp4', duracaoSeg: 31, tamanho: 2048000 });

  const d = mapearMensagem(msg({ documentWithCaptionMessage: { message: { documentMessage: { caption: 'contrato assinado', fileName: 'contrato.pdf', mimetype: 'application/pdf' } } } }), 'notify', ctx());
  assert.equal(d.tipoMidia, 'documento');
  assert.equal(d.corpo, 'contrato assinado');
  assert.equal(d.midia.nomeArquivo, 'contrato.pdf');
});

test('áudio de voz (ptt) com duração e sem corpo', () => {
  const ev = mapearMensagem(msg({ audioMessage: { seconds: 42, ptt: true, mimetype: 'audio/ogg; codecs=opus' } }), 'notify', ctx());
  assert.equal(ev.tipoMidia, 'audio');
  assert.equal(ev.corpo, null);
  assert.deepEqual(ev.midia, { mimetype: 'audio/ogg; codecs=opus', duracaoSeg: 42, ptt: true });
});

test('anúncio Click-to-WhatsApp vem bruto em anuncio', () => {
  const ev = mapearMensagem(msg({
    extendedTextMessage: {
      text: 'Olá! Vi o anúncio do plano trimestral',
      contextInfo: {
        conversionSource: 'FB_Ads',
        entryPointConversionSource: 'ctwa_ad',
        entryPointConversionApp: 'instagram',
        externalAdReply: {
          title: 'Plano trimestral', body: 'Treine 3x por semana', sourceType: 'ad', sourceId: '120210000000000',
          sourceUrl: 'https://fb.me/abc', ctwaClid: 'AfcXYZ', thumbnail: new Uint8Array([1, 2, 3]),
        },
      },
    },
  }), 'notify', ctx());
  assert.deepEqual(ev.anuncio, {
    sourceType: 'ad', sourceId: '120210000000000', sourceUrl: 'https://fb.me/abc', ctwaClid: 'AfcXYZ',
    titulo: 'Plano trimestral', corpo: 'Treine 3x por semana', conversionSource: 'FB_Ads',
    entryPointConversionSource: 'ctwa_ad', entryPointConversionApp: 'instagram',
  });
  // Mensagem do próprio mentorado nunca carrega anúncio.
  const minha = mapearMensagem(msg({ extendedTextMessage: { text: 'x', contextInfo: { conversionSource: 'FB_Ads' } } }, { fromMe: true }), 'notify', ctx());
  assert.equal(minha.anuncio, null);
});

test('conversa por LID: telefone real vem de senderPn e fica aprendido', () => {
  const c = ctx();
  const lid = '103843987759126@lid';
  const m = msg({ conversation: 'oi' }, { remoteJid: lid, senderPn: '5565999990000@s.whatsapp.net' });
  assert.deepEqual(paresLid(m), [[lid, '5565999990000@s.whatsapp.net']]);
  const ev = mapearMensagem(m, 'notify', c);
  assert.equal(ev.chatJid, lid);
  assert.equal(ev.lid, lid);
  assert.equal(ev.telefone, '5565999990000');
  assert.equal(ev.telefoneConfirmado, true);

  // Mensagem seguinte do mesmo LID, sem senderPn: o mapa resolve.
  const ev2 = mapearMensagem(msg({ conversation: 'tudo bem?' }, { remoteJid: lid, id: '3EB0BBBB' }), 'notify', c);
  assert.equal(ev2.telefone, '5565999990000');

  // E a resposta do mentorado (fromMe) não ensina nada: senderPn ali seria o dele.
  assert.deepEqual(paresLid(msg({ conversation: 'x' }, { remoteJid: lid, fromMe: true, senderPn: EU })), []);
});

test('LID sem telefone conhecido: telefone null e telefoneConfirmado false (nunca os dígitos do LID)', () => {
  const ev = mapearMensagem(msg({ conversation: 'oi' }, { remoteJid: '777777777777777@lid' }), 'notify', ctx());
  assert.equal(ev.telefone, null);
  assert.equal(ev.telefoneConfirmado, false);
  assert.equal(ev.lid, '777777777777777@lid');
});

test('conversa por telefone com senderLid: lid preenchido', () => {
  const c = ctx();
  const ev = mapearMensagem(msg({ conversation: 'oi' }, { senderLid: '555555555555555@lid' }), 'notify', c);
  assert.equal(ev.lid, '555555555555555@lid');
  assert.equal(c.lids.pnDe('555555555555555@lid'), CLIENTE);
});

test('reação vira tipoMidia reacao com o alvo em citadoWaId; tirar a reação não gera evento', () => {
  const ev = mapearMensagem(msg({ reactionMessage: { key: { remoteJid: CLIENTE, fromMe: true, id: '3EB0ALVO' }, text: '👍' } }), 'notify', ctx());
  assert.equal(ev.tipoMidia, 'reacao');
  assert.equal(ev.corpo, '👍');
  assert.equal(ev.citadoWaId, '3EB0ALVO');
  assert.equal(mapearMensagem(msg({ reactionMessage: { key: { id: '3EB0ALVO' }, text: '' } }), 'notify', ctx()), null);
});

test('edição (protocolMessage MESSAGE_EDIT, inclusive embrulhada em editedMessage)', () => {
  const pm = { type: 14, key: { remoteJid: CLIENTE, fromMe: false, id: '3EB0ORIG' }, editedMessage: { conversation: 'valor certo é 350' }, timestampMs: { toNumber: () => (TS + 5) * 1000 } };
  for (const message of [{ protocolMessage: pm }, { editedMessage: { message: { protocolMessage: pm } } }]) {
    const ev = mapearMensagem(msg(message, { id: '3EB0EDIT' }), 'notify', ctx());
    assert.deepEqual(ev, { tipo: 'edicao', waId: '3EB0ORIG', chatJid: CLIENTE, deMim: false, corpo: 'valor certo é 350', waEm: new Date((TS + 5) * 1000).toISOString() });
  }
});

test('apagada (protocolMessage REVOKE), também a do próprio mentorado', () => {
  const ev = mapearMensagem(msg({ protocolMessage: { type: 0, key: { id: '3EB0ORIG' } } }, { id: '3EB0DEL', fromMe: true }), 'notify', ctx());
  assert.deepEqual(ev, { tipo: 'apagada', waId: '3EB0ORIG', chatJid: CLIENTE, deMim: true, waEm: new Date(TS * 1000).toISOString() });
});

test('edição ou apagada apontando para outro chat é descartada', () => {
  const outro = '5565922220000@s.whatsapp.net';
  const forjada = { type: 14, key: { remoteJid: outro, id: '3EB0ORIG' }, editedMessage: { conversation: 'forjado' } };
  assert.equal(mapearMensagem(msg({ protocolMessage: forjada }, { id: '3EB0EDIT' }), 'notify', ctx()), null);
  assert.equal(mapearMensagem(msg({ protocolMessage: { type: 0, key: { remoteJid: outro, id: '3EB0ORIG' } } }, { id: '3EB0DEL' }), 'notify', ctx()), null);
});

test('protocolo que não é fala (aviso de histórico, chave de grupo, voto) não vira evento', () => {
  const c = ctx();
  assert.equal(mapearMensagem(msg({ protocolMessage: { type: 5, historySyncNotification: {} } }, { fromMe: true }), 'notify', c), null);
  assert.equal(mapearMensagem(msg({ senderKeyDistributionMessage: { groupId: GRUPO } }), 'notify', c), null);
  assert.equal(mapearMensagem(msg({ pollUpdateMessage: {} }), 'notify', c), null);
  assert.equal(lerConteudo({ messageContextInfo: {} }), null);
});

test('recibo: cliente leu o que o mentorado mandou; mentorado leu no celular; entregue de entrada é ruído', () => {
  const c = ctx();
  const r = mapearRecibos([
    { key: { remoteJid: CLIENTE, id: '3EB0SAI', fromMe: true }, update: { status: 4 } },
    { key: { remoteJid: CLIENTE, id: '3EB0SAI', fromMe: true }, update: { status: 3 } },
    { key: { remoteJid: CLIENTE, id: '3EB0ENT', fromMe: false }, update: { status: 4 } },
    { key: { remoteJid: CLIENTE, id: '3EB0ENT', fromMe: false }, update: { status: 3 } },
    { key: { remoteJid: CLIENTE, id: '3EB0AUD', fromMe: true }, update: { status: 5 } },
    { key: { remoteJid: CLIENTE, id: '3EB0X' }, update: { message: null, messageStubType: 1 } },
  ], c);
  const em = new Date(AGORA).toISOString();
  assert.deepEqual(r, [
    { tipo: 'recibo', waId: '3EB0SAI', chatJid: CLIENTE, deMim: true, status: 'lida', em },
    { tipo: 'recibo', waId: '3EB0SAI', chatJid: CLIENTE, deMim: true, status: 'entregue', em },
    { tipo: 'recibo', waId: '3EB0ENT', chatJid: CLIENTE, deMim: false, status: 'lida', em },
    { tipo: 'recibo', waId: '3EB0AUD', chatJid: CLIENTE, deMim: true, status: 'reproduzida', em },
  ]);
  const g = mapearRecibosGrupo([{ key: { remoteJid: GRUPO, id: 'G1', fromMe: true, participant: CLIENTE }, receipt: { userJid: CLIENTE, readTimestamp: TS } }], c);
  assert.deepEqual(g, [{ tipo: 'recibo', waId: 'G1', chatJid: GRUPO, deMim: true, status: 'lida', em: new Date(TS * 1000).toISOString() }]);
});

test('recibo grudado na mensagem (o buffer do Baileys fundiu o messages.update): vira recibo à parte', () => {
  const c = ctx();
  const minha = msg({ conversation: 'te mandei o link' }, { fromMe: true, id: '3EB0MINHA' }, { status: 4 });
  const ev = mapearMensagem(minha, 'append', c);
  assert.deepEqual(reciboEmbutido(minha, ev, c), { tipo: 'recibo', waId: '3EB0MINHA', chatJid: CLIENTE, deMim: true, status: 'lida', em: new Date(AGORA).toISOString() });
  // Mensagem minha só com o ack do servidor (2), a do cliente sem status, a entregue de entrada e o histórico: nada.
  const servidor = msg({ conversation: 'x' }, { fromMe: true }, { status: 2 });
  assert.equal(reciboEmbutido(servidor, mapearMensagem(servidor, 'notify', c), c), null);
  const doCliente = msg({ conversation: 'x' });
  assert.equal(reciboEmbutido(doCliente, mapearMensagem(doCliente, 'notify', c), c), null);
  const entregueDeEntrada = msg({ conversation: 'x' }, {}, { status: 3 });
  assert.equal(reciboEmbutido(entregueDeEntrada, mapearMensagem(entregueDeEntrada, 'notify', c), c), null);
  const lidaNoCelular = msg({ conversation: 'x' }, {}, { status: 4 });
  assert.equal(reciboEmbutido(lidaNoCelular, mapearMensagem(lidaNoCelular, 'append', c), c).deMim, false);
  assert.equal(reciboEmbutido(minha, mapearMensagem(minha, 'historico', c), c), null);
});

test('origemEvento: notify recente é tempo_real; append e notify atrasado são offline; histórico é historico', () => {
  const recente = mapearMensagem(msg({ conversation: 'a' }), 'notify', ctx());
  const append = mapearMensagem(msg({ conversation: 'a' }), 'append', ctx());
  const atrasado = mapearMensagem(msg({ conversation: 'a' }, {}, { messageTimestamp: TS - 3600 }), 'notify', ctx());
  const hist = mapearMensagem(msg({ conversation: 'a' }, {}, { messageTimestamp: { low: TS - 86400, high: 0, toNumber: () => TS - 86400 } }), 'historico', ctx());
  assert.equal(recente.origemEvento, 'tempo_real');
  assert.equal(append.origemEvento, 'offline');
  assert.equal(atrasado.origemEvento, 'offline');
  assert.equal(hist.origemEvento, 'historico');
  assert.equal(hist.waEm, new Date((TS - 86400) * 1000).toISOString());
  assert.equal(origemDoUpsert('notify', new Date(AGORA - 119_000).toISOString(), AGORA), 'tempo_real');
});

test('outros tipos: figurinha, localização, contato, enquete, resposta de botão', () => {
  const c = ctx();
  assert.equal(mapearMensagem(msg({ stickerMessage: { mimetype: 'image/webp' } }), 'notify', c).tipoMidia, 'figurinha');
  const loc = mapearMensagem(msg({ locationMessage: { degreesLatitude: -15.6, degreesLongitude: -56.1, name: 'Academia Centro' } }), 'notify', c);
  assert.equal(loc.tipoMidia, 'localizacao');
  assert.equal(loc.corpo, 'Academia Centro');
  assert.equal(mapearMensagem(msg({ contactMessage: { displayName: 'Dr. Paulo', vcard: 'BEGIN:VCARD' } }), 'notify', c).corpo, 'Dr. Paulo');
  const enq = mapearMensagem(msg({ pollCreationMessageV3: { name: 'Melhor horário?', options: [{ optionName: '6h' }, { optionName: '18h' }] } }), 'notify', c);
  assert.equal(enq.tipoMidia, 'enquete');
  assert.equal(enq.corpo, 'Melhor horário? (opções: 6h / 18h)');
  assert.equal(mapearMensagem(msg({ buttonsResponseMessage: { selectedDisplayText: 'Quero agendar' } }), 'notify', c).corpo, 'Quero agendar');
  assert.equal(mapearMensagem(msg({ eventMessage: { name: 'Aulão' } }), 'notify', c).tipoMidia, 'outro');
});

test('corpo sem \\u0000 (o Postgres recusa) e sem waId não há evento', () => {
  assert.equal(mapearMensagem(msg({ conversation: 'a\u0000b' }), 'notify', ctx()).corpo, 'ab');
  assert.equal(mapearMensagem(msg({ conversation: 'a' }, { id: undefined }), 'notify', ctx()), null);
});

test('normalizarConteudo abre envelopes aninhados e para em 5 níveis', () => {
  const r = normalizarConteudo({ ephemeralMessage: { message: { viewOnceMessage: { message: { audioMessage: { seconds: 3 } } } } } });
  assert.deepEqual(r, { conteudo: { audioMessage: { seconds: 3 } }, visualizacaoUnica: true });
});

test('grupos: só jid, nome e contagem de participantes, em ordem de nome', () => {
  const ev = mapearGrupos({
    [GRUPO]: { id: GRUPO, subject: 'Turma B', participants: [{ id: 'a' }, { id: 'b' }] },
    [OUTRO_GRUPO]: { id: OUTRO_GRUPO, subject: 'Alunos A', participants: [{ id: 'c' }] },
  });
  assert.deepEqual(ev, { tipo: 'grupos', grupos: [
    { jid: OUTRO_GRUPO, nome: 'Alunos A', participantes: 1 },
    { jid: GRUPO, nome: 'Turma B', participantes: 2 },
  ] });
});

test('chats_base: só conversas 1:1, sem corpo, com telefone do LID quando conhecido, em pedaços de 200', () => {
  const c = ctx();
  const chats = [
    { id: CLIENTE, name: 'João Academia', conversationTimestamp: { toNumber: () => TS - 86400 * 90 }, lidJid: '111@lid', messages: [{ message: { message: { conversation: 'segredo' } } }] },
    { id: '222@lid', pnJid: '5511900000000@s.whatsapp.net', conversationTimestamp: TS - 100 },
    { id: GRUPO, name: 'grupo' },
    { id: 'status@broadcast' },
  ];
  const [ev] = mapearChatsBase(chats, c);
  assert.deepEqual(ev, { tipo: 'chats_base', chats: [
    { jid: CLIENTE, telefone: '5565999990000', lid: '111@lid', nome: 'João Academia', ultimoEm: new Date((TS - 86400 * 90) * 1000).toISOString() },
    { jid: '222@lid', telefone: '5511900000000', lid: '222@lid', nome: null, ultimoEm: new Date((TS - 100) * 1000).toISOString() },
  ] });
  assert.ok(!JSON.stringify(ev).includes('segredo'));
  const muitos = Array.from({ length: 450 }, (_, i) => ({ id: `55659${String(i).padStart(8, '0')}@s.whatsapp.net` }));
  assert.deepEqual(mapearChatsBase(muitos, c).map((e) => e.chats.length), [200, 200, 50]);
});

test('pares LID de contatos e de chats do histórico', () => {
  const pares = paresLidDeContatos(
    [{ id: CLIENTE, lid: '1@lid' }, { id: '2@lid', jid: '5511911112222@s.whatsapp.net' }, { id: 'x@g.us' }],
    [{ id: '3@lid', pnJid: '5511933334444@s.whatsapp.net' }],
  );
  assert.deepEqual(pares, [['1@lid', CLIENTE], ['2@lid', '5511911112222@s.whatsapp.net'], ['3@lid', '5511933334444@s.whatsapp.net']]);
  const m = new MapaLid();
  assert.equal(m.aprender('1:3@lid', '5565999990000:7@s.whatsapp.net'), true);
  assert.equal(m.aprender('1@lid', CLIENTE), false);
  assert.equal(m.aprender(CLIENTE, '1@lid'), false); // ordem trocada não entra
  assert.deepEqual(new MapaLid(m.paraObjeto()).paraObjeto(), { '1@lid': CLIENTE });
});

test('waIdDaFila: formato do WhatsApp Web, determinístico por id', () => {
  const a = waIdDaFila('8f2d6a8e-1111-4b55-9d0f-0a0b0c0d0e0f');
  assert.match(a, /^3EB0[0-9A-F]{18}$/);
  assert.equal(a, waIdDaFila('8f2d6a8e-1111-4b55-9d0f-0a0b0c0d0e0f'));
  assert.notEqual(a, waIdDaFila('outro'));
});

test('telefone para o código de pareamento e jid normalizado', () => {
  assert.equal(telefoneParaPareamento('(65) 9 9999-0000'), '5565999990000');
  assert.equal(telefoneParaPareamento('+55 65 99999-0000'), '5565999990000');
  assert.equal(telefoneParaPareamento('+1 415 555 0100'), '14155550100');
  assert.equal(telefoneParaPareamento('5565999990000'), '5565999990000');
  assert.equal(jidNormalizado('5565999990000:12@s.whatsapp.net'), '5565999990000@s.whatsapp.net');
  assert.equal(jidNormalizado('5565999990000@c.us'), '5565999990000@s.whatsapp.net');
  assert.equal(jidNormalizado('sem-arroba'), '');
});
