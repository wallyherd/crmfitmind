// Fumaça com o Baileys 6.7.24 DE VERDADE, sem WhatsApp: o socket aponta para uma porta
// fechada em 127.0.0.1, então a conexão falha na hora. Prova que a configuração que a
// sessão monta é aceita pela versão fixada e que o histórico FULL fica de fora.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarSocketBaileys } from '../sessao.mjs';

test('criarSocketBaileys: Baileys 6.7.24 aceita a configuração (sem online, sem FULL, browser fixo)', async () => {
  const b = await import('@whiskeysockets/baileys');
  let config;
  const modulo = { ...b, default: (c) => { config = c; return b.default(c); } };
  const srv = createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const porta = srv.address().port;
  await new Promise((r) => srv.close(r));
  const pasta = await mkdtemp(join(tmpdir(), 'fumaca-'));
  try {
    const { sock } = await criarSocketBaileys({
      pastaAuth: join(pasta, 'auth'), getMessage: async () => undefined, modulo, urlWs: `ws://127.0.0.1:${porta}/ws/chat`,
    });
    const fechou = await new Promise((r) => sock.ev.on('connection.update', (u) => { if (u.connection === 'close') r(true); }));
    assert.equal(fechou, true);
    assert.deepEqual(config.browser.slice(0, 2), ['Mac OS', 'Chrome']);
    assert.equal(config.markOnlineOnConnect, false);
    assert.equal(config.syncFullHistory, false);
    const H = b.proto.Message.HistorySyncNotification;
    const T = H.HistorySyncType;
    assert.equal(config.shouldSyncHistoryMessage(H.fromObject({ syncType: T.FULL })), false);
    for (const t of [T.INITIAL_BOOTSTRAP, T.RECENT, T.PUSH_NAME]) {
      assert.equal(config.shouldSyncHistoryMessage(H.fromObject({ syncType: t })), true);
    }
    assert.equal(typeof sock.requestPairingCode, 'function');
    assert.equal(typeof sock.readMessages, 'function', 'existe, e a sessão nunca chama');
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});
